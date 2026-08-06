import { describe, it, expect, beforeAll } from 'vitest';
import { encryptField, decryptField, isEncrypted } from '../src/utils/crypto.js';

// Set MFA_SECRET_KEY before importing crypto.ts
process.env.MFA_SECRET_KEY = 'test-encryption-key';

// Force re-import so env is picked up
const crypto = await import('../src/utils/crypto.js');

describe('W3.9: AES-256-GCM field encryption', () => {
  const secret = 'JBSWY3DPEHPK3PXP';

  it('should encrypt and decrypt a round-trip secret', async () => {
    const encrypted = crypto.encryptField(secret);
    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toBe(secret);
    expect(crypto.isEncrypted(encrypted!)).toBe(true);

    const decrypted = crypto.decryptField(encrypted!);
    expect(decrypted).toBe(secret);
  });

  it('should produce different ciphertexts for the same plaintext (random nonce)', async () => {
    const enc1 = crypto.encryptField(secret);
    const enc2 = crypto.encryptField(secret);
    expect(enc1).not.toBe(enc2);
    expect(crypto.decryptField(enc1!)).toBe(secret);
    expect(crypto.decryptField(enc2!)).toBe(secret);
  });

  it('should return null/empty for null/undefined input', async () => {
    expect(crypto.encryptField(null)).toBeNull();
    expect(crypto.encryptField(undefined)).toBeNull();
    expect(crypto.encryptField('')).toBeNull();
    expect(crypto.decryptField(null)).toBeNull();
    expect(crypto.decryptField(undefined)).toBeNull();
    expect(crypto.decryptField('')).toBeNull();
  });

  it('should pass through legacy plaintext secrets (no v1: prefix)', async () => {
    const legacy = 'JBSWY3DPEHPK3PXP';
    expect(crypto.isEncrypted(legacy)).toBe(false);
    expect(crypto.decryptField(legacy)).toBe(legacy);
  });

  it('should return null for corrupted ciphertext', async () => {
    const garbage = 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:BBBB';
    const result = crypto.decryptField(garbage);
    expect(result).toBeNull();
  });
});
