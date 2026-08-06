import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { supabaseAdmin } from '../src/config/supabase.js';
import { buildMfaVerifiedValue, buildMfaTrustedValue, isMfaTrustedCookie } from '../src/middleware/cookies.js';

// Phase 5: Mock the MFA service before imports so the controller picks it up.
vi.mock('../src/services/mfa.service.js', () => ({
  generateTotpSecret: vi.fn().mockReturnValue('JBSWY3DPEHPK3PXP'),
  buildTotpUri: vi.fn().mockReturnValue('otpauth://totp/RenTech:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=RenTech'),
  verifyTotpToken: vi.fn().mockReturnValue(true),
  generateBackupCodes: vi.fn().mockReturnValue(['a1b2c3d4', 'e5f6g7h8']),
  consumeBackupCode: vi.fn().mockResolvedValue(true),
  setTotpSecret: vi.fn().mockResolvedValue({}),
  enableMfa: vi.fn().mockResolvedValue({}),
  disableMfa: vi.fn().mockResolvedValue({}),
  isMfaEnabled: vi.fn().mockResolvedValue(true),
}));

import * as mfaService from '../src/services/mfa.service.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', routes);
app.use(errorHandler);

describe('POST /api/auth/signup', () => {
  it('should create a new customer account', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'new@test.com', password: 'Password123!', name: 'New User' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('session');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('new@test.com');
    // Phase 1: cookies should be set
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_access='))).toBe(true);
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_refresh='))).toBe(true);
  });

  it('should reject invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'notanemail', password: 'Password123!', name: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should reject short password', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'test@test.com', password: '123', name: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should reject missing name', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'test@test.com', password: 'Password123!' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/auth/login', () => {
  it('should login successfully and return session + profile', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'test@example.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('session');
    expect(res.body).toHaveProperty('user');
    expect(res.body.session.access_token).toBe('mock-access-token-xyz');
    // Phase 1: cookies should be set on login
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_access='))).toBe(true);
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_refresh='))).toBe(true);
  });

  it('should reject missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
  });

  it('should skip the TOTP challenge for an MFA admin on a trusted device (rt_mfa_trusted)', async () => {
    // Drive the MFA-admin login path: Supabase returns the admin session.
    vi.mocked(supabaseAdmin.auth.signInWithPassword).mockImplementationOnce(async () => ({
      data: {
        user: { id: 'auth-admin-id-789', email: 'admin@example.com' },
        session: { access_token: 'mock-access-token-xyz', refresh_token: 'mock-refresh-token' },
      },
      error: null,
    }) as never);
    const trusted = buildMfaTrustedValue('admin@example.com');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', [`rt_mfa_trusted=${trusted}`])
      .send({ email: 'admin@example.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.requiresMfa).toBe(false);
    // Session cookies set AND the MFA marker minted so MFA-gated routes work
    // immediately after a trust-skip login.
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_access='))).toBe(true);
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_mfa_verified='))).toBe(true);
  });

  it('should still require MFA for an admin on an untrusted device', async () => {
    vi.mocked(supabaseAdmin.auth.signInWithPassword).mockImplementationOnce(async () => ({
      data: {
        user: { id: 'auth-admin-id-789', email: 'admin@example.com' },
        session: { access_token: 'mock-access-token-xyz', refresh_token: 'mock-refresh-token' },
      },
      error: null,
    }) as never);
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'admin@example.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.requiresMfa).toBe(true);
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_mfa_pending='))).toBe(true);
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_mfa_verified='))).toBe(false);
  });

  it('should ignore a trusted cookie bound to a different account', async () => {
    vi.mocked(supabaseAdmin.auth.signInWithPassword).mockImplementationOnce(async () => ({
      data: {
        user: { id: 'auth-admin-id-789', email: 'admin@example.com' },
        session: { access_token: 'mock-access-token-xyz', refresh_token: 'mock-refresh-token' },
      },
      error: null,
    }) as never);
    const trustedOther = buildMfaTrustedValue('other@example.com');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', [`rt_mfa_trusted=${trustedOther}`])
      .send({ email: 'admin@example.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.requiresMfa).toBe(true);
  });
});

describe('GET /api/auth/me', () => {
  it('should return profile when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('email', 'test@example.com');
    expect(res.body).toHaveProperty('name', 'Test User');
  });

  it('should return profile when authenticated via cookie', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', ['rt_access=valid-token']);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('email', 'test@example.com');
  });

  it('should return 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('should return 401 with malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Invalid');

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/me', () => {
  it('should update profile when authenticated', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', 'Bearer valid-token')
      .set('Origin', 'http://localhost:5173')
      .send({ name: 'Updated Name', phone: '09180000000' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'Updated Name');
    expect(res.body).toHaveProperty('phone', '09180000000');
  });

  it('should reject empty name', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', 'Bearer valid-token')
      .set('Origin', 'http://localhost:5173')
      .send({ name: '' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('should revoke refresh token and return success message', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', ['rt_refresh=mock-refresh-token']);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Logged out successfully');
    // Phase 1: should have called signOut to revoke the refresh token
    expect(supabaseAdmin.auth.admin.signOut).toHaveBeenCalledWith(
      expect.any(String)
    );
    // Phase 1: cookies should be cleared
    expect(res.headers['set-cookie']).toBeDefined();
    expect(
      res.headers['set-cookie'].some((c: string) =>
        c.startsWith('rt_access=;') || c.startsWith('rt_access=""')
      )
    ).toBe(true);
  });

  it('should still succeed without a refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost:5173');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Logged out successfully');
  });
});

// Phase 1: silent refresh endpoint
describe('POST /api/auth/refresh', () => {
  it('should refresh session with a valid refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', ['rt_refresh=mock-refresh-token']);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('session');
    expect(res.body.session.access_token).toBe('refreshed-access-token');
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_access='))).toBe(true);
  });

  it('should return 401 without a refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', []);

    expect(res.status).toBe(401);
  });

  it('should carry the MFA-verified marker over to the rotated access token', async () => {
    const oldMarker = buildMfaVerifiedValue('old-access-token');
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', [
        'rt_refresh=mock-refresh-token',
        'rt_access=old-access-token',
        `rt_mfa_verified=${oldMarker}`,
      ]);

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] as string[];
    const mfaCookie = setCookie.find((c) => c.startsWith('rt_mfa_verified='));
    expect(mfaCookie).toBeDefined();
    const newValue = mfaCookie!.split(';')[0].split('=')[1];
    // Re-minted for the NEW token — the old token-bound marker would be stale.
    expect(newValue).toBe(buildMfaVerifiedValue('refreshed-access-token'));
    expect(newValue).not.toBe(oldMarker);
  });

  it('should NOT mint the MFA-verified marker for a session that was never challenged', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', ['rt_refresh=mock-refresh-token', 'rt_access=old-access-token']);

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] as string[];
    expect(setCookie.some((c) => c.startsWith('rt_mfa_verified='))).toBe(false);
  });
});

// Phase 1: CSRF guard
describe('CSRF Guard', () => {
  it('should reject cross-origin POST without matching origin', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'https://evil-site.com');

    // No Bearer token + cross-origin → 403
    expect(res.status).toBe(403);
  });

  it('should allow same-origin POST', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost:5173');

    expect(res.status).toBe(200);
  });

  it('should allow Bearer-token requests without origin', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', 'Bearer valid-token')
      .send({ name: 'Token Auth User' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'Token Auth User');
  });
});

// Phase 2: password reset
describe('POST /api/auth/forgot-password', () => {
  it('should return 200 with generic message (no enumeration)', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'any@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
    expect(supabaseAdmin.auth.resetPasswordForEmail).toHaveBeenCalled();
  });
});

describe('POST /api/auth/reset-password', () => {
  it('should reset password with valid token', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ token_hash: 'valid-hash', password: 'newPassword123!' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset');
    expect(supabaseAdmin.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'valid-hash',
      type: 'recovery',
    });
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
      'auth-user-id-123',
      { password: 'newPassword123!' }
    );
  });

  it('should return 401 with invalid token', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(supabaseAdmin.auth.verifyOtp).mockResolvedValueOnce({
      data: { user: null, session: null }, error: { message: 'Invalid token' },
    });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ token_hash: 'bad-hash', password: 'newPassword123!' });

    expect(res.status).toBe(401);
  });
});

describe('Admin: Staff Management', () => {
  const adminAuth = { Authorization: 'Bearer admin-token' };

  describe('POST /api/auth/staff', () => {
    it('should create staff account when admin', async () => {
      const res = await request(app)
        .post('/api/auth/staff')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'staff@test.com', password: 'Staffpass123!', name: 'Staff User' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('role', 'Staff');
    });

    it('should reject without admin role', async () => {
      const res = await request(app)
        .post('/api/auth/staff')
        .set('Authorization', 'Bearer customer-token')
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'staff@test.com', password: 'Staffpass123!', name: 'Staff User' });

      expect(res.status).toBe(403);
    });

    it('should reject when not authenticated', async () => {
      const res = await request(app)
        .post('/api/auth/staff')
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'staff@test.com', password: 'Staffpass123!', name: 'Staff User' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/staff', () => {
    it('should list staff when admin', async () => {
      const res = await request(app)
        .get('/api/auth/staff')
        .set(adminAuth);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should reject non-admin', async () => {
      const res = await request(app)
        .get('/api/auth/staff')
        .set('Authorization', 'Bearer customer-token');

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/auth/staff/:id', () => {
    it('should remove staff when admin', async () => {
      const res = await request(app)
        .delete('/api/auth/staff/staff-id-456')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
    });

    it('should remove staff who was an SMS recipient (cleans sentSms)', async () => {
      const res = await request(app)
        .delete('/api/auth/staff/staff-id-456')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      const { prisma } = await import('../src/config/database.js');
      // sentSms.deleteMany should have been called for both recipient and sender cleanup
      expect(prisma.sentSms.deleteMany).toHaveBeenCalled();
    });

    it('should reject non-admin', async () => {
      const res = await request(app)
        .delete('/api/auth/staff/staff-id-456')
        .set('Authorization', 'Bearer customer-token');

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent staff', async () => {
      const res = await request(app)
        .delete('/api/auth/staff/staff-id-404')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(404);
    });
  });
});

// Phase 5: MFA tests

describe('Phase 5: MFA', () => {
  const adminAuth = { Authorization: 'Bearer admin-token' };

  beforeEach(() => {
    vi.mocked(mfaService.verifyTotpToken).mockClear();
    vi.mocked(mfaService.generateTotpSecret).mockClear();
    vi.mocked(mfaService.setTotpSecret).mockClear();
    vi.mocked(mfaService.enableMfa).mockClear();
    vi.mocked(mfaService.disableMfa).mockClear();
  });

  describe('POST /api/auth/mfa/setup', () => {
    it('should generate TOTP secret for admin', async () => {
      const res = await request(app)
        .post('/api/auth/mfa/setup')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('secret');
      expect(res.body).toHaveProperty('qrUri');
      expect(res.body).toHaveProperty('qrDataUri'); // server-rendered data URI (no external image service)
      expect(mfaService.generateTotpSecret).toHaveBeenCalled();
      expect(mfaService.setTotpSecret).toHaveBeenCalledWith('auth-admin-id-789', 'JBSWY3DPEHPK3PXP');
    });

    it('should reject non-admin', async () => {
      const res = await request(app)
        .post('/api/auth/mfa/setup')
        .set('Authorization', 'Bearer customer-token')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated', async () => {
      const res = await request(app)
        .post('/api/auth/mfa/setup')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/mfa/enable', () => {
    it('should enable MFA with valid code', async () => {
      const res = await request(app)
        .post('/api/auth/mfa/enable')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', ['rt_access=admin-token'])
        .send({ code: '123456', backupCodes: ['a1b2c3d4', 'e5f6g7h8'] });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('MFA enabled');
      expect(mfaService.verifyTotpToken).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP', '123456');
      expect(mfaService.enableMfa).toHaveBeenCalledWith('auth-admin-id-789', ['a1b2c3d4', 'e5f6g7h8']);
      // The admin just proved possession of the second factor — the current
      // session is marked MFA-verified without needing a re-login.
      expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_mfa_verified='))).toBe(true);
    });

    it('should reject invalid TOTP code', async () => {
      vi.mocked(mfaService.verifyTotpToken).mockReturnValueOnce(false);
      const res = await request(app)
        .post('/api/auth/mfa/enable')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173')
        .send({ code: '000000', backupCodes: ['a1b2c3d4'] });

      expect(res.status).toBe(401);
    });

    it('should reject when no secret is set up', async () => {
      vi.mocked(mfaService.verifyTotpToken).mockClear();
      const { prisma } = await import('../src/config/database.js');
      const originalImpl = vi.mocked(prisma.profile.findUnique).getMockImplementation();
      // Mock profile lookup based on select property:
      // - authMiddleware: no select → return full admin profile
      // - requireMfaAdmin: select: { mfaEnabled: true } → return { mfaEnabled: true }
      // - mfaEnable controller: select: { totpSecret: true } → return { totpSecret: null }
      vi.mocked(prisma.profile.findUnique).mockImplementation((args) => {
        if (args.select && args.select.totpSecret === true) {
          return Promise.resolve({ totpSecret: null });
        }
        if (args.select && args.select.mfaEnabled === true) {
          return Promise.resolve({ mfaEnabled: true });
        }
        // No select = authMiddleware needs full profile
        return Promise.resolve({
          id: 'admin-id-789', userId: 'auth-admin-id-789', email: 'admin@example.com',
          role: 'Admin', name: 'Admin User', mfaEnabled: true,
          totpSecret: 'JBSWY3DPEHPK3PXP',
        });
      });
      const res = await request(app)
        .post('/api/auth/mfa/enable')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173')
        .send({ code: '123456', backupCodes: ['a1b2c3d4'] });

      expect(res.status).toBe(400);
      // Restore original implementation so subsequent tests aren't affected
      vi.mocked(prisma.profile.findUnique).mockImplementation(originalImpl);
    });
  });

  describe('POST /api/auth/mfa/disable', () => {
    it('should disable MFA for admin', async () => {
      const res = await request(app)
        .post('/api/auth/mfa/disable')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(mfaService.disableMfa).toHaveBeenCalledWith('auth-admin-id-789');
    });

    it('should reject non-admin', async () => {
      const res = await request(app)
        .post('/api/auth/mfa/disable')
        .set('Authorization', 'Bearer customer-token')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/auth/login/mfa', () => {
    // W2.7: MFA challenge tokens are read from the rt_mfa_pending cookie,
    // not the request body. The body only carries the 6-digit code.
    it('should verify TOTP code and set cookies', async () => {
      const res = await request(app)
        .post('/api/auth/login/mfa')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', [`rt_mfa_pending=admin-token|||mock-refresh-token`])
        .send({ code: '123456' });

      expect(res.status).toBe(200);
      expect(mfaService.verifyTotpToken).toHaveBeenCalled();
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_access='))).toBe(true);
      // W2.7+: successful challenge mints the MFA-verified marker so
      // requireMfaAdmin accepts this session as AAL=2.
      expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_mfa_verified='))).toBe(true);
    });

    it('should accept backup code as fallback', async () => {
      vi.mocked(mfaService.verifyTotpToken).mockReturnValueOnce(false);
      const res = await request(app)
        .post('/api/auth/login/mfa')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', [`rt_mfa_pending=admin-token|||mock-refresh-token`])
        .send({ code: 'backup123' });

      expect(res.status).toBe(200);
      expect(mfaService.consumeBackupCode).toHaveBeenCalled();
    });

    it('should mint rt_mfa_trusted when trustDevice is set', async () => {
      const res = await request(app)
        .post('/api/auth/login/mfa')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', [`rt_mfa_pending=admin-token|||mock-refresh-token`])
        .send({ code: '123456', trustDevice: true });

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_mfa_trusted='))).toBe(true);
    });

    it('should NOT mint rt_mfa_trusted when trustDevice is absent', async () => {
      const res = await request(app)
        .post('/api/auth/login/mfa')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', [`rt_mfa_pending=admin-token|||mock-refresh-token`])
        .send({ code: '123456' });

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_mfa_trusted='))).toBe(false);
    });

    it('should reject invalid TOTP and invalid backup code', async () => {
      vi.mocked(mfaService.verifyTotpToken).mockReturnValueOnce(false);
      vi.mocked(mfaService.consumeBackupCode).mockResolvedValueOnce(false);
      const res = await request(app)
        .post('/api/auth/login/mfa')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', [`rt_mfa_pending=admin-token|||mock-refresh-token`])
        .send({ code: '000000' });

      expect(res.status).toBe(401);
    });

    it('should reject when MFA is not enabled', async () => {
      vi.mocked(mfaService.verifyTotpToken).mockClear();
      vi.mocked(mfaService.consumeBackupCode).mockClear();
      const { prisma } = await import('../src/config/database.js');
      vi.mocked(prisma.profile.findUnique).mockResolvedValueOnce({
        id: 'profile-1', userId: 'auth-admin-id-789', email: 'admin@example.com',
        role: 'Admin', name: 'Test Admin', mfaEnabled: false, totpSecret: null, backupCodes: null,
      });
      const res = await request(app)
        .post('/api/auth/login/mfa')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', [`rt_mfa_pending=admin-token|||mock-refresh-token`])
        .send({ code: '123456' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('MFA not enabled');
    });
  });
});

// The homegrown TOTP can never raise the Supabase JWT `aal` claim to 2, so
// requireMfaAdmin must accept the server-issued rt_mfa_verified marker as the
// proof that a second factor was verified for this exact access token.
describe('requireMfaAdmin + rt_mfa_verified marker (GET /api/auth/staff)', () => {
  // Capture the setup.ts getUser implementation — the beforeEach overrides it
  // per-test, and afterEach must RESTORE it (mockReset would wipe it for every
  // later test, e.g. the OAuth callback tests, which then 500 on undefined).
  const defaultGetUser = supabaseAdmin.auth.getUser.getMockImplementation();

  // Force the admin session to AAL=1 (like every real password login: the
  // local TOTP challenge doesn't advance Supabase's AAL).
  beforeEach(() => {
    vi.mocked(supabaseAdmin.auth.getUser).mockImplementation(async () => ({
      data: {
        user: {
          id: 'auth-admin-id-789',
          email: 'admin@example.com',
          app_metadata: { aal: 1 },
        },
      },
      error: null,
    }) as never);
  });

  afterEach(() => {
    vi.mocked(supabaseAdmin.auth.getUser).mockImplementation(defaultGetUser!);
  });

  it('rejects an AAL=1 admin session that never completed a challenge', async () => {
    const res = await request(app)
      .get('/api/auth/staff')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('MFA challenge required');
  });

  it('accepts an AAL=1 admin session carrying a valid rt_mfa_verified marker', async () => {
    const marker = buildMfaVerifiedValue('admin-token');
    expect(marker).not.toBeNull();
    const res = await request(app)
      .get('/api/auth/staff')
      .set('Authorization', 'Bearer admin-token')
      .set('Cookie', [`rt_mfa_verified=${marker}`]);

    expect(res.status).toBe(200);
  });

  it('rejects a marker that was minted for a different access token', async () => {
    const otherMarker = buildMfaVerifiedValue('some-other-token');
    const res = await request(app)
      .get('/api/auth/staff')
      .set('Authorization', 'Bearer admin-token')
      .set('Cookie', [`rt_mfa_verified=${otherMarker}`]);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('MFA challenge required');
  });

  it('rejects a tampered marker', async () => {
    const res = await request(app)
      .get('/api/auth/staff')
      .set('Authorization', 'Bearer admin-token')
      .set('Cookie', ['rt_mfa_verified=v1.tamperedvalue']);

    expect(res.status).toBe(403);
  });
});

describe('Phase 3: OAuth callback (PKCE exchange)', () => {
  const stubTokenEndpoint = () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'oauth-access-token',
        refresh_token: 'oauth-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
      }),
    }));
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges the code and redirects to home for a complete profile', async () => {
    stubTokenEndpoint();
    const res = await request(app)
      .get('/api/auth/oauth/callback?code=oauth-code-123')
      .set('Cookie', ['rt_oauth_pkce=some-verifier']);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/');
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_access='))).toBe(true);
  });

  it('redirects to the details form for an incomplete profile', async () => {
    stubTokenEndpoint();
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'new-oauth-user', email: 'new.oauth@example.com' } },
      error: null,
    } as never);
    const res = await request(app)
      .get('/api/auth/oauth/callback?code=oauth-code-123')
      .set('Cookie', ['rt_oauth_pkce=some-verifier']);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/oauth-details');
    expect(res.headers.location).toContain('new.oauth%40example.com');
  });

  it('rejects a missing code', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/callback')
      .set('Cookie', ['rt_oauth_pkce=some-verifier']);

    expect(res.status).toBe(400);
  });
});

describe('rt_mfa_trusted (trust-this-device) cookie helpers', () => {
  it('round-trips: verifies for the matching identity, rejects others', () => {
    const v = buildMfaTrustedValue('admin@example.com');
    expect(v).not.toBeNull();
    expect(isMfaTrustedCookie({ cookies: { rt_mfa_trusted: v } } as any, 'admin@example.com')).toBe(true);
    expect(isMfaTrustedCookie({ cookies: { rt_mfa_trusted: v } } as any, 'other@example.com')).toBe(false);
    expect(isMfaTrustedCookie({ cookies: {} } as any, 'admin@example.com')).toBe(false);
    expect(isMfaTrustedCookie({ cookies: { rt_mfa_trusted: 'v1.tampered' } } as any, 'admin@example.com')).toBe(false);
  });

  it('values differ from MFA markers (separate HMAC domain)', () => {
    const trusted = buildMfaTrustedValue('admin@example.com');
    const marker = buildMfaVerifiedValue('admin@example.com');
    expect(trusted).not.toBe(marker);
  });
});
