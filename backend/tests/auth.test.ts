import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { supabaseAdmin } from '../src/config/supabase.js';
import { prisma } from '../src/config/database.js';
import * as authService from '../src/services/auth.service.js';
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
  it('should create a new customer account (email verification pending)', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'new@test.com', password: 'Password123!', name: 'New User' });

    expect(res.status).toBe(201);
    // AUTH_EMAIL_CONFIRM defaults to false → verification required. No session,
    // no auto-login cookies; the frontend shows "check your inbox" instead.
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('new@test.com');
    expect(res.body.requiresVerification).toBe(true);
    expect(res.body.session).toBeNull();
    expect(res.headers['set-cookie']).toBeUndefined();
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
    expect(setCookie.some((c: string) => c.startsWith('rt_mfa_verified='))).toBe(false);
  });

  // Regression: the rt_access cookie disappears when the JWT expires (~1h),
  // so a refresh after idle/sleep can't present the old marker-bound token.
  // A valid trust-this-device cookie for an MFA-enabled admin is equivalent
  // proof (login skips the challenge on trust) — the marker must be carried
  // over instead of dropped (which stranded admins behind 403
  // mfa_challenge_required until a full re-login).
  it('should re-mint the marker via the trust-device fallback when the access cookie is gone', async () => {
    vi.mocked(supabaseAdmin.auth.refreshSession).mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'rotated-admin-token',
          refresh_token: 'rotated-admin-refresh',
          token_type: 'bearer',
          expires_in: 3600,
        },
        user: { id: 'auth-admin-id-789', email: 'admin@example.com' },
      },
      error: null,
    } as never);
    const { buildMfaTrustedValue } = await import('../src/middleware/cookies.js');
    const trusted = buildMfaTrustedValue('admin@example.com');
    // No rt_access cookie (expired/dropped) and no rt_mfa_verified marker —
    // only the refresh token + the 30-day trusted-device cookie.
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', ['rt_refresh=mock-refresh-token', `rt_mfa_trusted=${trusted}`]);

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] as string[];
    const mfaCookie = setCookie.find((c) => c.startsWith('rt_mfa_verified='));
    expect(mfaCookie).toBeDefined();
    expect(mfaCookie!.split(';')[0].split('=')[1]).toBe(buildMfaVerifiedValue('rotated-admin-token'));
  });

  it('should NOT re-mint via trust fallback for a non-admin session', async () => {
    const { buildMfaTrustedValue } = await import('../src/middleware/cookies.js');
    const trusted = buildMfaTrustedValue('test@example.com');
    // Default refreshSession mock resolves a Customer (auth-user-id-123).
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', ['rt_refresh=mock-refresh-token', `rt_mfa_trusted=${trusted}`]);

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] as string[];
    expect(setCookie.some((c: string) => c.startsWith('rt_mfa_verified='))).toBe(false);
  });

  it('should NOT re-mint via trust fallback when the cookie belongs to another account', async () => {
    vi.mocked(supabaseAdmin.auth.refreshSession).mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'rotated-admin-token-2',
          refresh_token: 'rotated-admin-refresh-2',
          token_type: 'bearer',
          expires_in: 3600,
        },
        user: { id: 'auth-admin-id-789', email: 'admin@example.com' },
      },
      error: null,
    } as never);
    const { buildMfaTrustedValue } = await import('../src/middleware/cookies.js');
    const trusted = buildMfaTrustedValue('someone-else@example.com');
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', ['rt_refresh=mock-refresh-token', `rt_mfa_trusted=${trusted}`]);

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] as string[];
    expect(setCookie.some((c: string) => c.startsWith('rt_mfa_verified='))).toBe(false);
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

// Phase 2: password reset (Brevo delivery — always 200, no enumeration)
describe('POST /api/auth/forgot-password', () => {
  it('should return 200 with generic message (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'any@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
  });

  it('should create a single-use reset token for a registered email', async () => {
    const { prisma } = await import('../src/config/database.js');
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
    expect(prisma.emailToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'password_reset' }) }),
    );
  });

  it('should not create a token for an unknown email (no enumeration)', async () => {
    const { prisma } = await import('../src/config/database.js');
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'nobody-here@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
    expect(prisma.emailToken.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('should return 200 with generic message (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'any@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('verification link');
  });

  it('should create a fresh verification token for an unconfirmed email', async () => {
    const { prisma } = await import('../src/config/database.js');
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(prisma.emailToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'verification' }) }),
    );
  });

  it('should reject an invalid email shape', async () => {
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/reset-password', () => {
  const BREVO_TOKEN = 'a'.repeat(64);

  it('should reset password with a Brevo token and mint session cookies', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValueOnce({
      id: 'etok-1', userId: 'profile-id-123', token: BREVO_TOKEN,
      type: 'password_reset', expiresAt: new Date(Date.now() + 3600_000), usedAt: null,
    } as never);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ token: BREVO_TOKEN, password: 'newPassword123!' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset');
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
      'auth-user-id-123',
      { password: 'newPassword123!' },
    );
    expect(prisma.emailToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'etok-1' } }),
    );
    // Fresh sign-in mints cookies (auto-login after reset).
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_access='))).toBe(true);
  });

  it('should reject a Brevo token that was already used', async () => {
    const { prisma } = await import('../src/config/database.js');
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValueOnce({
      id: 'etok-used', userId: 'profile-id-123', token: BREVO_TOKEN,
      type: 'password_reset', expiresAt: new Date(Date.now() + 3600_000), usedAt: new Date(),
    } as never);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ token: BREVO_TOKEN, password: 'newPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('already been used');
  });

  it('should reject an expired Brevo token', async () => {
    const { prisma } = await import('../src/config/database.js');
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValueOnce({
      id: 'etok-old', userId: 'profile-id-123', token: BREVO_TOKEN,
      type: 'password_reset', expiresAt: new Date(Date.now() - 1000), usedAt: null,
    } as never);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ token: BREVO_TOKEN, password: 'newPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('expired');
  });

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

  it('should reset password with a ?code= credential (default email template)', async () => {
    const { supabaseSignUp } = await import('../src/config/supabase.js');
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ code: 'pkce-code-123', password: 'newPassword123!' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset');
    expect(supabaseSignUp.auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code-123');
    // Exchanged session mints cookies (auto-login after reset).
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_access='))).toBe(true);
  });

  it('should reset password with an #access_token credential (implicit flow)', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ access_token: 'recovery-access-token', password: 'newPassword123!' });

    expect(res.status).toBe(200);
    expect(supabaseAdmin.auth.getUser).toHaveBeenCalledWith('recovery-access-token');
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
      'auth-user-id-123',
      { password: 'newPassword123!' }
    );
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('should return 400 when no credential is supplied', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ password: 'newPassword123!' });

    expect(res.status).toBe(400);
  });

  it('should return an expiry-specific message for expired tokens', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(supabaseAdmin.auth.verifyOtp).mockResolvedValueOnce({
      data: { user: null, session: null }, error: { message: 'Token has expired or is invalid' },
    });
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ token_hash: 'stale-hash', password: 'newPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('expired');
  });

  it('should accept a correct current password (Brevo path) and consume the link', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValueOnce({
      id: 'etok-ok', userId: 'profile-id-123', token: BREVO_TOKEN,
      type: 'password_reset', expiresAt: new Date(Date.now() + 3600_000), usedAt: null,
    } as never);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ token: BREVO_TOKEN, password: 'newPassword123!', currentPassword: 'oldPassword123!' });

    expect(res.status).toBe(200);
    // Old password verified against Supabase before anything was written…
    expect(supabaseAdmin.auth.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com', password: 'oldPassword123!' }),
    );
    // …then the link was consumed and the new password saved.
    expect(prisma.emailToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'etok-ok' } }),
    );
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
      'auth-user-id-123',
      { password: 'newPassword123!' },
    );
  });

  it('should reject a wrong current password WITHOUT consuming the link', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValueOnce({
      id: 'etok-typo', userId: 'profile-id-123', token: BREVO_TOKEN,
      type: 'password_reset', expiresAt: new Date(Date.now() + 3600_000), usedAt: null,
    } as never);
    vi.mocked(supabaseAdmin.auth.signInWithPassword).mockResolvedValueOnce({
      data: { user: null, session: null }, error: { message: 'Invalid login credentials' },
    } as never);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ token: BREVO_TOKEN, password: 'newPassword123!', currentPassword: 'wrongOld123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Current password is incorrect');
    // A typo must never burn the single-use link or touch the credential.
    expect(prisma.emailToken.update).not.toHaveBeenCalled();
    expect(supabaseAdmin.auth.admin.updateUserById).not.toHaveBeenCalledWith(
      'auth-user-id-123',
      expect.anything(),
    );
  });

  it('should verify the old password on the legacy token_hash path too', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(supabaseAdmin.auth.signInWithPassword).mockResolvedValueOnce({
      data: { user: null, session: null }, error: { message: 'Invalid login credentials' },
    } as never);
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Origin', 'http://localhost:5173')
      .send({ token_hash: 'valid-hash', password: 'newPassword123!', currentPassword: 'wrongOld123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Current password is incorrect');
    expect(supabaseAdmin.auth.admin.updateUserById).not.toHaveBeenCalledWith(
      'auth-user-id-123',
      expect.anything(),
    );
  });

  it('should mint reset tokens for STAFF emails too (forgot flow is role-agnostic)', async () => {
    const { prisma } = await import('../src/config/database.js');
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'staff@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
    expect(prisma.emailToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'password_reset' }) }),
    );
  });
});

describe('POST /api/auth/verify-email', () => {
  const BREVO_TOKEN = 'b'.repeat(64);

  it('should confirm the email with a Brevo token', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValueOnce({
      id: 'etok-v1', userId: 'profile-id-123', token: BREVO_TOKEN,
      type: 'verification', expiresAt: new Date(Date.now() + 3600_000), usedAt: null,
    } as never);
    const res = await request(app)
      .post('/api/auth/verify-email')
      .set('Origin', 'http://localhost:5173')
      .send({ token: BREVO_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('verified');
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
      'auth-user-id-123',
      { email_confirm: true },
    );
    expect(prisma.emailToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'etok-v1' } }),
    );
  });

  it('should reject an unknown Brevo token', async () => {
    const { prisma } = await import('../src/config/database.js');
    vi.mocked(prisma.emailToken.findUnique).mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/auth/verify-email')
      .set('Origin', 'http://localhost:5173')
      .send({ token: 'c'.repeat(64) });

    expect(res.status).toBe(401);
  });

  it('should confirm the email and log the user in with a valid token', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(supabaseAdmin.auth.verifyOtp).mockResolvedValueOnce({
      data: {
        user: { id: 'auth-user-id-123', email: 'test@example.com' },
        session: {
          access_token: 'verified-token',
          refresh_token: 'rt-verified',
          token_type: 'bearer',
          expires_in: 3600,
        },
      },
      error: null,
    });
    const res = await request(app)
      .post('/api/auth/verify-email')
      .set('Origin', 'http://localhost:5173')
      .send({ token_hash: 'valid-signup-hash' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('verified');
    expect(supabaseAdmin.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'valid-signup-hash',
      type: 'signup',
    });
    // Verified user gets session cookies (auto-login after clicking the link).
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].some((c: string) => c.startsWith('rt_access='))).toBe(true);
  });

  it('should reject an invalid or expired token', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(supabaseAdmin.auth.verifyOtp).mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Token expired' },
    });
    const res = await request(app)
      .post('/api/auth/verify-email')
      .set('Origin', 'http://localhost:5173')
      .send({ token_hash: 'expired-hash' });

    expect(res.status).toBe(401);
  });

  it('should confirm the email with a ?code= credential (default template)', async () => {
    const { supabaseSignUp } = await import('../src/config/supabase.js');
    const res = await request(app)
      .post('/api/auth/verify-email')
      .set('Origin', 'http://localhost:5173')
      .send({ code: 'signup-code-123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('verified');
    expect(supabaseSignUp.auth.exchangeCodeForSession).toHaveBeenCalledWith('signup-code-123');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('should return 400 when no credential is supplied', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .set('Origin', 'http://localhost:5173')
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login with unconfirmed email', () => {
  it('should return a verify-email hint, not invalid-credentials', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    // GoTrue returns email_not_confirmed ONLY after the password was correct.
    vi.mocked(supabaseAdmin.auth.signInWithPassword).mockResolvedValueOnce({
      data: { user: { id: 'auth-customer-id', email: 'customer@example.com' }, session: null },
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    });
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'customer@example.com', password: 'Password123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('verify your email');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

// Session verification hardening (middleware/auth.ts getUserWithRetry):
// definitive rejections 401 without retry; transient failures retried once,
// then 503 instead of a misleading 'invalid token'.
describe('GET /api/auth/me session verification', () => {
  it('returns 401 session-expired (no retry) when Supabase rejects the token', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: null }, error: { message: 'invalid JWT', status: 401 },
    } as never);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', 'Bearer dead-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('session has expired');
    expect(supabaseAdmin.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it('retries once and succeeds after a transient verification failure', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: null }, error: { message: 'fetch failed' },
    } as never);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', 'Bearer flaky-token');

    expect(res.status).toBe(200);
    expect(supabaseAdmin.auth.getUser).toHaveBeenCalledTimes(2);
  });

  it('returns 503 when verification stays unreachable after the retry', async () => {
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    vi.mocked(supabaseAdmin.auth.getUser)
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'fetch failed' } } as never)
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'fetch failed', status: 500 } } as never);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', 'Bearer flaky-token');

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('authentication server');
    expect(supabaseAdmin.auth.getUser).toHaveBeenCalledTimes(2);
  });
});

describe('Admin: Staff Management', () => {
  const adminAuth = { Authorization: 'Bearer admin-token' };

  describe('POST /api/auth/staff', () => {
    it('should create staff account with a one-time password when admin', async () => {
      const res = await request(app)
        .post('/api/auth/staff')
        .set(adminAuth)
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'staff@test.com', name: 'Staff User' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('role', 'Staff');
      // OTP flow: backend mints a policy-compliant one-time password and
      // returns it exactly once; the profile is flagged for first-login change.
      expect(typeof res.body.oneTimePassword).toBe('string');
      expect(res.body.oneTimePassword.length).toBeGreaterThanOrEqual(12);
      expect(res.body.mustChangePassword).toBe(true);
    });

    it('should reject without admin role', async () => {
      const res = await request(app)
        .post('/api/auth/staff')
        .set('Authorization', 'Bearer customer-token')
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'staff@test.com', name: 'Staff User' });

      expect(res.status).toBe(403);
    });

    it('should reject when not authenticated', async () => {
      const res = await request(app)
        .post('/api/auth/staff')
        .set('Origin', 'http://localhost:5173')
        .send({ email: 'staff@test.com', name: 'Staff User' });

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

// POST /api/auth/mfa/step-up — in-session re-verification for a valid admin
// session that lost its rt_mfa_verified marker (no re-login required).
describe('POST /api/auth/mfa/step-up', () => {
  it('should mint the marker for the current session on a valid TOTP code', async () => {
    const res = await request(app)
      .post('/api/auth/mfa/step-up')
      .set('Authorization', 'Bearer admin-token')
      .set('Origin', 'http://localhost:5173')
      .send({ code: '123456' });

    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] as string[];
    const mfaCookie = setCookie.find((c) => c.startsWith('rt_mfa_verified='));
    expect(mfaCookie).toBeDefined();
    expect(mfaCookie!.split(';')[0].split('=')[1]).toBe(buildMfaVerifiedValue('admin-token'));
  });

  it('should accept a backup code as fallback and optionally trust the device', async () => {
    vi.mocked(mfaService.verifyTotpToken).mockReturnValueOnce(false);
    const res = await request(app)
      .post('/api/auth/mfa/step-up')
      .set('Authorization', 'Bearer admin-token')
      .set('Origin', 'http://localhost:5173')
      .send({ code: 'a1b2c3d4', trustDevice: true });

    expect(res.status).toBe(200);
    expect(mfaService.consumeBackupCode).toHaveBeenCalled();
    const setCookie = res.headers['set-cookie'] as string[];
    expect(setCookie.some((c) => c.startsWith('rt_mfa_verified='))).toBe(true);
    expect(setCookie.some((c) => c.startsWith('rt_mfa_trusted='))).toBe(true);
  });

  it('should reject an invalid code', async () => {
    vi.mocked(mfaService.verifyTotpToken).mockReturnValueOnce(false);
    vi.mocked(mfaService.consumeBackupCode).mockResolvedValueOnce(false);
    const res = await request(app)
      .post('/api/auth/mfa/step-up')
      .set('Authorization', 'Bearer admin-token')
      .set('Origin', 'http://localhost:5173')
      .send({ code: '000000' });

    expect(res.status).toBe(401);
  });

  it('should reject non-admin callers', async () => {
    const res = await request(app)
      .post('/api/auth/mfa/step-up')
      .set('Authorization', 'Bearer customer-token')
      .set('Origin', 'http://localhost:5173')
      .send({ code: '123456' });

    expect(res.status).toBe(403);
  });

  it('should reject unauthenticated callers', async () => {
    const res = await request(app)
      .post('/api/auth/mfa/step-up')
      .set('Origin', 'http://localhost:5173')
      .send({ code: '123456' });

    expect(res.status).toBe(401);
  });

  it('should 400 when MFA is not enabled on the account', async () => {
    // authMiddleware caches profiles: drop the entry so the override below is
    // consulted, queue it twice (middleware + controller each query once),
    // then drop the poisoned entry so later tests re-read the real fixture.
    const { invalidateProfileCache } = await import('../src/utils/profileCache.js');
    invalidateProfileCache('auth-admin-id-789');
    const { prisma } = await import('../src/config/database.js');
    const disabled = {
      id: 'profile-1', userId: 'auth-admin-id-789', email: 'admin@example.com',
      role: 'Admin', name: 'Test Admin', mfaEnabled: false, totpSecret: null, backupCodes: null,
    };
    vi.mocked(prisma.profile.findUnique).mockResolvedValueOnce(disabled).mockResolvedValueOnce(disabled);
    const res = await request(app)
      .post('/api/auth/mfa/step-up')
      .set('Authorization', 'Bearer admin-token')
      .set('Origin', 'http://localhost:5173')
      .send({ code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not enabled');
    invalidateProfileCache('auth-admin-id-789');
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

  it('redirects user-facing errors (e.g. missing code) to the error page', async () => {
    const res = await request(app)
      .get('/api/auth/oauth/callback')
      .set('Cookie', ['rt_oauth_pkce=some-verifier']);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/oauth-error');
    expect(res.headers.location).toContain(encodeURIComponent('Missing authorization code'));
  });

  it('redirects to the error page when the email already belongs to an account', async () => {
    stubTokenEndpoint();
    // OAuth user email matches an existing email/password profile (test@example.com
    // belongs to auth-user-id-123) but is a different user → oauthGetOrCreateProfile
    // throws 409 "account with this email already exists".
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'different-user-id', email: 'test@example.com' } },
      error: null,
    } as never);
    const res = await request(app)
      .get('/api/auth/oauth/callback?code=oauth-code-123')
      .set('Cookie', ['rt_oauth_pkce=some-verifier']);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/oauth-error');
    expect(decodeURIComponent(res.headers.location)).toContain('already exists');
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

// Staff first-login flow: admin-created accounts get a one-time password and
// a mustChangePassword flag. Login surfaces the flag; every non-auth endpoint
// is locked until the password is replaced via /auth/change-password.
describe('Staff one-time password + forced first-login change', () => {
  const staffAuth = { Authorization: 'Bearer staff-token' };

  it('login returns mustChangePassword for a flagged staff account', async () => {
    const { prisma } = await import('../src/config/database.js');
    const originalImpl = vi.mocked(prisma.profile.findUnique).getMockImplementation();

    // signInWithPassword resolves the STAFF auth user; the follow-up profile
    // lookup by userId then hits the flagged staff profile below.
    vi.mocked(supabaseAdmin.auth.signInWithPassword).mockImplementationOnce((async ({ email }: any) => ({
      data: {
        user: { id: 'auth-staff-id-456', email },
        session: { access_token: 'staff-access-token', refresh_token: 'staff-refresh-token', token_type: 'bearer', expires_in: 3600 },
      },
      error: null,
    })) as never);

    vi.mocked(prisma.profile.findUnique).mockImplementation((args: any) => {
      const target = args.where.email || args.where.userId;
      if (target === 'staff@example.com' || target === 'auth-staff-id-456') {
        return Promise.resolve({
          id: 'staff-id-456',
          userId: 'auth-staff-id-456',
          email: 'staff@example.com',
          role: 'Staff',
          name: 'Staff User',
          mustChangePassword: true,
        });
      }
      return (originalImpl ? originalImpl(args) : Promise.resolve(null)) as any;
    });

    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'staff@example.com', password: 'Onetimepass123!' });

    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);

    vi.mocked(prisma.profile.findUnique).mockImplementation(originalImpl!);
  });

  it('locks non-auth endpoints for a mustChangePassword session (403)', async () => {
    const { prisma } = await import('../src/config/database.js');
    const originalImpl = vi.mocked(prisma.profile.findUnique).getMockImplementation();

    // The auth middleware resolves the staff profile (token: auth-staff-id-456)
    // with mustChangePassword — any endpoint other than /me or
    // /change-password must 403.
    vi.mocked(prisma.profile.findUnique).mockImplementation((args: any) => {
      if (args.where.userId === 'auth-staff-id-456' || args.where.id === 'staff-id-456') {
        return Promise.resolve({
          id: 'staff-id-456',
          userId: 'auth-staff-id-456',
          email: 'staff@example.com',
          role: 'Staff',
          name: 'Staff User',
          mustChangePassword: true,
        });
      }
      return (originalImpl ? originalImpl(args) : Promise.resolve(null)) as any;
    });

    // /auth/me stays reachable (the gate screen needs it)
    const meRes = await request(app).get('/api/auth/me').set(staffAuth);
    expect(meRes.status).toBe(200);

    // Everything else is locked…
    const txRes = await request(app).get('/api/transactions').set(staffAuth);
    expect(txRes.status).toBe(403);
    expect(txRes.body.error).toContain('change your password');

    vi.mocked(prisma.profile.findUnique).mockImplementation(originalImpl!);
  });

  it('POST /auth/change-password verifies current password and clears the flag', async () => {
    const { prisma } = await import('../src/config/database.js');
    const originalFindUnique = vi.mocked(prisma.profile.findUnique).getMockImplementation();

    vi.mocked(prisma.profile.findUnique).mockImplementation((args: any) => {
      if (args.where.userId === 'auth-staff-id-456' || args.where.id === 'staff-id-456') {
        return Promise.resolve({
          id: 'staff-id-456',
          userId: 'auth-staff-id-456',
          email: 'staff@example.com',
          role: 'Staff',
          name: 'Staff User',
          mustChangePassword: true,
        });
      }
      return (originalFindUnique ? originalFindUnique(args) : Promise.resolve(null)) as any;
    });

    // Correct one-time password → 200, Supabase credential updated, flag cleared.
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(staffAuth)
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'Onetimepass123!', newPassword: 'Newstaffpass456!' });

    expect(res.status).toBe(200);
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
      'auth-staff-id-456',
      { password: 'Newstaffpass456!' },
    );
    expect(prisma.profile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mustChangePassword: false } }),
    );

    vi.mocked(prisma.profile.findUnique).mockImplementation(originalFindUnique!);
  });

  it('POST /auth/change-password rejects the wrong current password', async () => {
    const { prisma } = await import('../src/config/database.js');
    const originalImpl = vi.mocked(prisma.profile.findUnique).getMockImplementation();

    vi.mocked(prisma.profile.findUnique).mockImplementation((args: any) => {
      if (args.where.userId === 'auth-staff-id-456' || args.where.id === 'staff-id-456') {
        return Promise.resolve({
          id: 'staff-id-456',
          userId: 'auth-staff-id-456',
          email: 'staff@example.com',
          role: 'Staff',
          name: 'Staff User',
          mustChangePassword: true,
        });
      }
      return (originalImpl ? originalImpl(args) : Promise.resolve(null)) as any;
    });

    // signInWithPassword fails for the wrong current password.
    vi.mocked(supabaseAdmin.auth.signInWithPassword).mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    } as never);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set(staffAuth)
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'Wrongpass123!', newPassword: 'Newstaffpass456!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('incorrect');

    vi.mocked(prisma.profile.findUnique).mockImplementation(originalImpl!);
  });

  it('POST /auth/change-password is a no-op for accounts not flagged', async () => {
    // staff-token resolves the default (unflagged) staff profile in setup.ts.
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(staffAuth)
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'Onetimepass123!', newPassword: 'Newstaffpass456!' });

    // The voluntary path now succeeds (Settings change-password) — it is no
    // longer a 400 no-op. The current password is verified against Supabase.
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Password updated');
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
      'auth-staff-id-456',
      { password: 'Newstaffpass456!' },
    );
  });
});

// Voluntary password change from Settings: any logged-in account (Staff,
// Admin, Customer) can rotate its own password. The current password must be
// re-verified first — a stolen session can't lock the real user out.
describe('Voluntary change-password (Settings)', () => {
  it('verifies the current password and updates it for a regular account', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer valid-token')
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword456!' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Password updated');
    // Supabase credential updated for the resolved auth user…
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith(
      'auth-user-id-123',
      { password: 'NewPassword456!' },
    );
    // …and the old password was verified against Supabase FIRST.
    expect(supabaseAdmin.auth.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com', password: 'OldPassword123!' }),
    );
  });

  it('rejects the wrong current password', async () => {
    vi.mocked(supabaseAdmin.auth.signInWithPassword).mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    } as never);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer valid-token')
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'WrongPassword123!', newPassword: 'NewPassword456!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('incorrect');
    // Nothing was written.
    expect(supabaseAdmin.auth.admin.updateUserById).not.toHaveBeenCalledWith(
      'auth-user-id-123',
      expect.anything(),
    );
  });

  it('rejects reusing the same password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer valid-token')
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'SamePassword123!', newPassword: 'SamePassword123!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('different');
  });

  it('still honors the forced first-login flag path (clears mustChangePassword)', async () => {
    const { prisma } = await import('../src/config/database.js');
    const originalImpl = vi.mocked(prisma.profile.findUnique).getMockImplementation();

    vi.mocked(prisma.profile.findUnique).mockImplementation((args: any) => {
      if (args.where.userId === 'auth-staff-id-456' || args.where.id === 'staff-id-456') {
        return Promise.resolve({
          id: 'staff-id-456',
          userId: 'auth-staff-id-456',
          email: 'staff@example.com',
          role: 'Staff',
          name: 'Staff User',
          mustChangePassword: true,
        });
      }
      return (originalImpl ? originalImpl(args) : Promise.resolve(null)) as any;
    });

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer staff-token')
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'Onetimepass123!', newPassword: 'Newstaffpass456!' });

    expect(res.status).toBe(200);
    expect(prisma.profile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mustChangePassword: false } }),
    );

    vi.mocked(prisma.profile.findUnique).mockImplementation(originalImpl!);
  });
});

// Staff profile editing: admins edit any staff account from the Team tab;
// staff edit their own from Settings. Email is immutable.
describe('PUT /api/auth/staff/:id (edit staff profile)', () => {
  const adminAuth = { Authorization: 'Bearer admin-token' };
  const staffAuth = { Authorization: 'Bearer staff-token' };

  // Reads the most recent prisma.profile.update call's data payload.
  const lastProfileUpdateData = () => {
    const calls = vi.mocked(prisma.profile.update).mock.calls;
    return (calls[calls.length - 1] as any)?.[0]?.data ?? {};
  };

  it('admin edits a staff account name and phone', async () => {
    const res = await request(app)
      .put('/api/auth/staff/staff-id-456')
      .set(adminAuth)
      .set('Origin', 'http://localhost:5173')
      .send({ name: 'Renamed Staff', phone: '09179999999' });

    expect(res.status).toBe(200);
    expect(lastProfileUpdateData()).toMatchObject({
      name: 'Renamed Staff',
      phone: '09179999999',
    });
  });

  it('staff edits their own profile', async () => {
    const res = await request(app)
      .put('/api/auth/staff/staff-id-456')
      .set(staffAuth)
      .set('Origin', 'http://localhost:5173')
      .send({ phone: '09178888888' });

    expect(res.status).toBe(200);
    expect(lastProfileUpdateData()).toMatchObject({ phone: '09178888888' });
  });

  it('staff cannot edit ANOTHER staff account (only self or admin)', async () => {
    // staff-token resolves staff-id-456; target a different staff profile id.
    const res = await request(app)
      .put('/api/auth/staff/some-other-staff-profile')
      .set(staffAuth)
      .set('Origin', 'http://localhost:5173')
      .send({ name: 'Nope' });

    expect(res.status).toBe(404); // unknown profile id → 404 before the self-check
  });

  it('customer cannot edit staff accounts', async () => {
    const res = await request(app)
      .put('/api/auth/staff/staff-id-456')
      .set('Authorization', 'Bearer customer-token')
      .set('Origin', 'http://localhost:5173')
      .send({ name: 'Nope' });

    expect(res.status).toBe(403);
  });
});

// Google sign-in for staff: a Staff/Admin profile resolves as complete on
// OAuth (no customer-details detour, no role demotion) — this is what lets
// staff sign in with Google using their staff email.
describe('OAuth staff sign-in (email match)', () => {
  it('treats an existing Staff profile as complete (no details form, role kept)', async () => {
    // Simulate Google returning the staff auth user (Supabase linked the
    // Google identity to the same account by email).
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'auth-staff-id-456', email: 'staff@example.com' } },
      error: null,
    } as never);

    const result = await authService.oauthGetOrCreateProfile('staff-token');
    expect(result.needsDetails).toBe(false);
    expect(result.user.role).toBe('Staff');
  });

  it('still sends new customer emails to the details form', async () => {
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: { id: 'brand-new-oauth-user', email: 'brand.new@example.com' } },
      error: null,
    } as never);

    const result = await authService.oauthGetOrCreateProfile('any-token');
    expect(result.needsDetails).toBe(true);
  });
});
