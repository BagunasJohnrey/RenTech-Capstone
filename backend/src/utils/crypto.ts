/**
 * AES-256-GCM encryption / decryption for sensitive fields stored in the DB.
 *
 * Why: totpSecret is a plaintext TOTP shared secret sitting in the Profile table.
 * If the database were compromised (e.g. a leaked backup), an attacker could
 * forge MFA codes for every admin. Encrypting at rest with a key that lives in
 * the environment (not the DB) raises the bar significantly.
 *
 * Format: "v1:<base64 nonce>:<base64 ciphertext+tag>"
 * The v1 prefix allows future key-rotation format changes.
 *
 * In dev (MFA_SECRET_KEY unset), encrypt/decrypt become pass-throughs so the
 * existing test fixtures (plaintext secrets) keep working.
 */

import * as crypto from 'crypto';
import { env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const PREFIX = 'v1:';
const NONCE_LEN = 12; // 96-bit nonce, standard for GCM

function getKey(): Buffer | null {
  if (!env.MFA_SECRET_KEY) return null;
  // Stretch any-length key string to 32 bytes via SHA-256 (standard approach
  // for deriving a fixed key from a passphrase).
  return crypto.createHash('sha256').update(env.MFA_SECRET_KEY).digest();
}

export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return null;
  const key = getKey();
  if (!key) return plaintext; // dev: no key → store as-is

  const nonce = crypto.randomBytes(NONCE_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, tag]);

  return `${PREFIX}${nonce.toString('base64')}:${combined.toString('base64')}`;
}

export function decryptField(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null || ciphertext === '') return null;

  // Legacy plaintext secrets (from before encryption was enabled) are
  // identified by the absence of the v1: prefix and passed through unchanged.
  // This lets us migrate databases incrementally — old plaintext rows still
  // work until the migration script encrypts them.
  if (!ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }

  const key = getKey();
  if (!key) return null; // encrypted but no key → can't decrypt

  const body = ciphertext.slice(PREFIX.length);
  const [nonceB64, combinedB64] = body.split(':');
  if (!nonceB64 || !combinedB64) return null;

  try {
    const nonce = Buffer.from(nonceB64, 'base64');
    const combined = Buffer.from(combinedB64, 'base64');
    const tag = combined.slice(-16);
    const encrypted = combined.slice(0, -16);

    const decipher = crypto.createDecipheriv(ALGO, key, nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function isEncrypted(value: string | null | undefined): boolean {
  return value != null && value.startsWith(PREFIX);
}
