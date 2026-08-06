import * as crypto from 'crypto';
import { prisma } from '../config/database.js';
import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import { encryptField, decryptField } from '../utils/crypto.js';

const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // accept current + 1 past step (30s)

/**
 * Generate a base32-encoded TOTP secret (shared between server and authenticator app).
 * Uses RFC 4226-compliant random bytes (20 bytes → 160 bits, the standard TOTP secret length).
 */
export function generateTotpSecret(): string {
  const buf = crypto.randomBytes(20);
  return base32Encode(buf);
}

/**
 * Build an otpauth:// URI for QR code generation in authenticator apps.
 */
export function buildTotpUri(secret: string, email: string, issuer = 'RenTech'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({
    secret,
    issuer: issuer,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS.toString(),
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Verify a TOTP token against a secret. Accepts the current 30-second window
 * plus one step before/after for clock skew tolerance.
 */
export function verifyTotpToken(secret: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const step = 30;
  const counter = Math.floor(Date.now() / 1000 / step);
  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    if (totpForCounter(secret, counter + i) === token) return true;
  }
  return false;
}

/**
 * Core TOTP: HMAC-SHA1 over the counter, truncated to 6 digits (RFC 4226).
 */
function totpForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = counter === 0 ? 0 : Math.floor(counter / 256);
  }
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  // RFC 4226 dynamic truncation: mask to 0x7f (0x7F) so the sign bit is the
  // only bit dropped. Using 0x3f drops bit 6 too, which breaks the code for
  // roughly 40% of all counters (once in every few 30s windows).
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** TOTP_DIGITS;
  return otp.toString().padStart(TOTP_DIGITS, '0');
}

/** Base32 (RFC 4648) encode — no padding for TOTP secrets. */
function base32Encode(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let result = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >> bits) & 31];
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }
  return result;
}

/** Base32 (RFC 4648) decode — accepts with or without padding. */
function base32Decode(str: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = str.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  let byteArr: number[] = [];
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      byteArr.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(byteArr);
}

/**
 * Generate a random backup code (16 hex chars, 64 bits of entropy per code).
 */
export function generateBackupCode(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Generate a set of one-time backup codes server-side. The client displays
 * these once and never persists them.
 */
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => generateBackupCode());
}

/**
 * Persist a TOTP secret for an admin (pending enrollment — not yet enabled).
 * The secret is encrypted at rest via AES-256-GCM when MFA_SECRET_KEY is set.
 */
export async function setTotpSecret(userId: string, secret: string) {
  await prisma.profile.update({
    where: { userId },
    data: {
      totpSecret: encryptField(secret),
      mfaEnabled: false,
      backupCodes: Prisma.JsonNull,
    },
  });
}

/**
 * Enable MFA for an admin — sets mfaEnabled and stores backup codes.
 */
export async function enableMfa(userId: string, backupCodes: string[]) {
  await prisma.profile.update({
    where: { userId },
    data: {
      mfaEnabled: true,
      backupCodes: backupCodes as unknown as Prisma.InputJsonArray,
    },
  });
}

/**
 * Disable MFA for an admin — clears the secret and backup codes.
 */
export async function disableMfa(userId: string) {
  await prisma.profile.update({
    where: { userId },
    data: {
      mfaEnabled: false,
      totpSecret: null,
      backupCodes: Prisma.JsonNull,
    },
  });
}

/**
 * Verify a backup code (one-time use). Consumes the code by removing it from
 * the stored list.
 */
export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { backupCodes: true },
  });
  if (!profile?.backupCodes) return false;
  let codes: string[];
  try {
    // Normal case: stored as a JSON array. Legacy rows written by enableMfa
    // before the fix stored JSON.stringify(...) — a JSON *string* — which
    // reads back as a string; parse it so those codes still work.
    if (Array.isArray(profile.backupCodes)) {
      codes = profile.backupCodes as string[];
    } else if (typeof profile.backupCodes === 'string') {
      const parsed = JSON.parse(profile.backupCodes);
      codes = Array.isArray(parsed) ? parsed : [];
    } else {
      codes = [];
    }
  } catch {
    return false;
  }
  if (!codes.includes(code)) return false;
  const idx = codes.indexOf(code);
  if (idx === -1) return false;
  codes.splice(idx, 1);
  await prisma.profile.update({
    where: { userId },
    data: { backupCodes: codes as unknown as Prisma.InputJsonArray },
  });
  return true;
}

/**
 * Check whether MFA is enabled for a user.
 */
export async function isMfaEnabled(userId: string): Promise<boolean> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { mfaEnabled: true },
  });
  return profile?.mfaEnabled ?? false;
}
