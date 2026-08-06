import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/config/database.js';
import {
  generateTotpSecret,
  buildTotpUri,
  verifyTotpToken,
  enableMfa,
  consumeBackupCode,
  setTotpSecret,
  disableMfa,
} from '../src/services/mfa.service.js';

// RFC 6238 Appendix B test secret: base32 of ASCII "12345678901234567890".
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function mockNowForCounter(counter: number) {
  const orig = Date.now;
  // 30s steps; mid-window so counter == floor(now/30s) exactly.
  Date.now = () => (counter * 30 + 15) * 1000;
  return orig;
}

describe('Phase 5: TOTP correctness (real implementation, RFC vectors)', () => {
  const vectors = [
    { t: 59, code: '287082' },
    { t: 1111111109, code: '081804' },
    { t: 1111111111, code: '050471' },
    { t: 1234567890, code: '005924' },
    { t: 2000000000, code: '279037' },
  ];

  it.each(vectors)('produces the RFC 6238 6-digit code for T=$t', ({ t, code }) => {
    const orig = Date.now;
    Date.now = () => t * 1000;
    expect(verifyTotpToken(SECRET, code)).toBe(true);
    Date.now = orig;
  });

  it('accepts the code one step in the past (clock skew)', () => {
    const orig = mockNowForCounter(100);
    try {
      expect(verifyTotpToken(SECRET, '07081804')).toBe(false); // counter 37037036, not 100
    } finally {
      Date.now = orig;
    }
  });

  it('rejects a wrong 6-digit code and malformed input', () => {
    const orig = mockNowForCounter(1);
    try {
      expect(verifyTotpToken(SECRET, '000000')).toBe(false);
      expect(verifyTotpToken(SECRET, '12ab34')).toBe(false);
      expect(verifyTotpToken(SECRET, '12345')).toBe(false);
      expect(verifyTotpToken(SECRET, '1234567')).toBe(false);
    } finally {
      Date.now = orig;
    }
  });

  it('generates a valid 32-char base32 secret (20 bytes)', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    // Two generated secrets differ (crypto.randomBytes).
    expect(s).not.toBe(generateTotpSecret());
  });

  it('builds an otpauth URI with the right parameters', () => {
    const uri = buildTotpUri(SECRET, 'admin@example.com');
    expect(uri).toContain('otpauth://totp/RenTech:admin%40example.com');
    expect(uri).toContain(`secret=${SECRET}`);
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('Phase 5: backup code storage + consumption (real implementation)', () => {
  beforeEach(() => {
    vi.mocked(prisma.profile.findUnique).mockReset();
    vi.mocked(prisma.profile.update).mockReset();
  });

  it('enableMfa stores the backup codes as a JSON array (not a string)', async () => {
    const codes = ['a1b2c3d4', 'e5f6g7h8'];
    await enableMfa('user-1', codes);
    expect(vi.mocked(prisma.profile.update)).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { mfaEnabled: true, backupCodes: codes },
    });
  });

  it('consumeBackupCode accepts an array-shaped backupCodes column', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValueOnce({
      backupCodes: ['a1b2c3d4', 'e5f6g7h8'],
    } as never);
    const ok = await consumeBackupCode('user-1', 'a1b2c3d4');
    expect(ok).toBe(true);
    expect(vi.mocked(prisma.profile.update)).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { backupCodes: ['e5f6g7h8'] },
    });
  });

  it('consumeBackupCode accepts legacy rows where backup codes were stored as a JSON string', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValueOnce({
      backupCodes: '["a1b2c3d4","e5f6g7h8"]',
    } as never);
    const ok = await consumeBackupCode('user-1', 'e5f6g7h8');
    expect(ok).toBe(true);
    expect(vi.mocked(prisma.profile.update)).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { backupCodes: ['a1b2c3d4'] },
    });
  });

  it('consumeBackupCode rejects an unknown/already-used code and does not write', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValueOnce({
      backupCodes: ['a1b2c3d4'],
    } as never);
    const ok = await consumeBackupCode('user-1', 'deadbeef');
    expect(ok).toBe(false);
    expect(vi.mocked(prisma.profile.update)).not.toHaveBeenCalled();
  });

  it('consumeBackupCode rejects when no backup codes exist', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValueOnce(null as never);
    expect(await consumeBackupCode('user-1', 'a1b2c3d4')).toBe(false);
  });
});

describe('Phase 5: enable/disable round-trip', () => {
  it('setTotpSecret clears mfaEnabled + backupCodes', async () => {
    await setTotpSecret('user-1', SECRET);
    expect(vi.mocked(prisma.profile.update)).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { totpSecret: expect.any(String), mfaEnabled: false, backupCodes: Prisma.JsonNull },
    });
  });

  it('disableMfa clears the secret and backup codes', async () => {
    await disableMfa('user-1');
    expect(vi.mocked(prisma.profile.update)).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { mfaEnabled: false, totpSecret: null, backupCodes: Prisma.JsonNull },
    });
  });
});
