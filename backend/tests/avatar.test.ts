import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { prisma } from '../src/config/database.js';
import { invalidateProfileCache } from '../src/utils/profileCache.js';
import { AppError } from '../src/middleware/errorHandler.js';

// Never touch real storage in tests — the service's upload/remove are mocked,
// and failure paths are driven per-test.
vi.mock('../src/services/storage.service.js', () => ({
  uploadFile: vi.fn(),
  removeObject: vi.fn(),
  getDownloadUrl: vi.fn(),
  bucketFor: vi.fn((p: string) => 'rentech-catalog'),
  isConditionPath: vi.fn((p: string) => p.startsWith('rental/')),
}));

import * as storageService from '../src/services/storage.service.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', routes);
app.use(errorHandler);

const ORIGIN = 'http://localhost:5173';
const AUTH = { Authorization: 'Bearer valid-token' };
const DATA = Buffer.from('fake-image-bytes').toString('base64');
const NEW_PATH = 'avatars/profile-id-123-1.webp';

function baseProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-id-123',
    userId: 'auth-user-id-123',
    email: 'test@example.com',
    role: 'Customer',
    name: 'Test User',
    phone: '09171234567',
    address: 'Test Address',
    avatarPath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Queue prisma answers in call order: authMiddleware findUnique → service
// findUnique (load) → update → getProfile findUnique (return).
function queueAvatarFlow(opts: { previous?: string | null; next?: string | null } = {}) {
  const { previous = null, next = NEW_PATH } = opts;
  vi.mocked(prisma.profile.findUnique)
    .mockResolvedValueOnce(baseProfile() as never) // middleware
    .mockResolvedValueOnce(baseProfile({ avatarPath: previous }) as never) // service load
    .mockResolvedValueOnce(baseProfile({ avatarPath: next }) as never); // getProfile return
  vi.mocked(prisma.profile.update).mockResolvedValueOnce(baseProfile({ avatarPath: next }) as never);
}

beforeEach(() => {
  // The auth middleware caches profiles for 30s — drop the entry so every
  // test's queue is consumed in order (middleware + service + return).
  invalidateProfileCache('auth-user-id-123');
  // Reset the shared prisma mocks: mockResolvedValueOnce queues persist
  // across tests, so each test below queues EXACTLY the calls its flow makes
  // (a stranded value would shift every later test's queue).
  vi.mocked(prisma.profile.findUnique).mockReset();
  vi.mocked(prisma.profile.update).mockReset();
  vi.mocked(storageService.uploadFile).mockReset().mockResolvedValue({ path: NEW_PATH, thumbPath: null });
  vi.mocked(storageService.removeObject).mockReset().mockResolvedValue(undefined);
});

describe('POST /api/auth/me/avatar', () => {
  it('uploads and returns the profile with avatarPath', async () => {
    queueAvatarFlow();
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set(AUTH)
      .set('Origin', ORIGIN)
      .send({ fileName: 'avatar.jpg', contentType: 'image/jpeg', data: DATA });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('avatarPath', NEW_PATH);
    // Never leaks MFA secrets alongside the new field.
    expect(res.body).not.toHaveProperty('totpSecret');
    expect(res.body).not.toHaveProperty('backupCodes');
    const key = vi.mocked(storageService.uploadFile).mock.calls[0][0] as string;
    expect(key.startsWith('avatars/')).toBe(true);
    // No previous photo → no delete.
    expect(storageService.removeObject).not.toHaveBeenCalled();
    // Profile persisted with the new path.
    expect(prisma.profile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ avatarPath: NEW_PATH }) })
    );
  });

  it('deletes the previous photo on swap', async () => {
    queueAvatarFlow({ previous: 'avatars/profile-id-123-old.webp' });
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set(AUTH)
      .set('Origin', ORIGIN)
      .send({ fileName: 'avatar.jpg', contentType: 'image/jpeg', data: DATA });

    expect(res.status).toBe(200);
    expect(storageService.removeObject).toHaveBeenCalledWith('avatars/profile-id-123-old.webp');
  });

  it('rejects unauthenticated uploads', async () => {
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Origin', ORIGIN)
      .send({ fileName: 'avatar.jpg', contentType: 'image/jpeg', data: DATA });

    expect(res.status).toBe(401);
    expect(storageService.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects missing fields', async () => {
    // Middleware resolves the profile, then zod rejects — service never runs.
    vi.mocked(prisma.profile.findUnique).mockResolvedValueOnce(baseProfile() as never);
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set(AUTH)
      .set('Origin', ORIGIN)
      .send({ fileName: 'avatar.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(storageService.uploadFile).not.toHaveBeenCalled();
  });

  it('surfaces a corrupt-image failure without writing the profile', async () => {
    // Middleware + service load run; the upload throws before any write.
    vi.mocked(prisma.profile.findUnique)
      .mockResolvedValueOnce(baseProfile() as never)
      .mockResolvedValueOnce(baseProfile() as never);
    vi.mocked(storageService.uploadFile).mockReset().mockRejectedValueOnce(new AppError(400, 'Unsupported image format'));
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set(AUTH)
      .set('Origin', ORIGIN)
      .send({ fileName: 'avatar.jpg', contentType: 'image/jpeg', data: DATA });

    expect(res.status).toBe(400);
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/auth/me/avatar', () => {
  it('clears the photo and removes the object', async () => {
    queueAvatarFlow({ previous: NEW_PATH, next: null });
    const res = await request(app)
      .delete('/api/auth/me/avatar')
      .set(AUTH)
      .set('Origin', ORIGIN);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('avatarPath', null);
    expect(storageService.removeObject).toHaveBeenCalledWith(NEW_PATH);
  });

  it('succeeds with no photo set (nothing to delete)', async () => {
    queueAvatarFlow({ previous: null, next: null });
    const res = await request(app)
      .delete('/api/auth/me/avatar')
      .set(AUTH)
      .set('Origin', ORIGIN);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('avatarPath', null);
    expect(storageService.removeObject).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated deletes', async () => {
    const res = await request(app).delete('/api/auth/me/avatar').set('Origin', ORIGIN);
    expect(res.status).toBe(401);
  });
});

describe('malformed JSON payloads', () => {
  // body-parser SyntaxErrors used to fall through to a 500; they are a
  // client bug and must answer 400 (regression pin for the live 500s).
  it('answers 400 for a broken JSON body', async () => {
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{"fileName":');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid request payload');
  });
});
