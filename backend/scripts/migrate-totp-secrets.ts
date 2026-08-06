/**
 * W3.9: Encrypt existing plaintext TOTP secrets at rest.
 *
 * Run after setting MFA_SECRET_KEY in the environment:
 *   MFA_SECRET_KEY=your-32-byte-secret npx tsx scripts/migrate-totp-secrets.ts
 *
 * This script:
 *  1. Reads every profile row that has a plaintext totpSecret (no "v1:" prefix).
 *  2. Encrypts it with AES-256-GCM.
 *  3. Writes the ciphertext back to the same row.
 *  4. Skips rows that are already encrypted (idempotent — safe to re-run).
 *
 * NOTE: This requires the backend to be STOPPED — Prisma engine DLLs can't be
 * held by a running process when you run `prisma generate` / direct queries
 * via the generated client. In practice, `npx tsx` loads the engine on its own,
 * but if the backend is running, stop it first to avoid lock contention.
 */

import { prisma } from '../src/config/database.js';
import { encryptField, isEncrypted } from '../src/utils/crypto.js';
import { env } from '../src/config/env.js';

async function main() {
  if (!env.MFA_SECRET_KEY) {
    console.error('MFA_SECRET_KEY is not set — cannot encrypt secrets.');
    console.error('Generate one with: openssl rand -base64 32');
    process.exit(1);
  }

  console.log('Scanning for plaintext TOTP secrets...');
  const profiles = await prisma.profile.findMany({
    where: { totpSecret: { not: null } },
    select: { userId: true, email: true, totpSecret: true },
  });

  const plaintext = profiles.filter((p) => p.totpSecret && !isEncrypted(p.totpSecret));
  console.log(`Found ${plaintext.length} plaintext secret(s) out of ${profiles.length} total.`);

  if (plaintext.length === 0) {
    console.log('Nothing to migrate. Done.');
    return;
  }

  let migrated = 0;
  for (const p of plaintext) {
    const encrypted = encryptField(p.totpSecret!);
    if (!encrypted || isEncrypted(p.totpSecret!)) continue;
    try {
      await prisma.profile.update({
        where: { userId: p.userId },
        data: { totpSecret: encrypted },
      });
      migrated++;
      console.log(`  ✓ ${p.email}: encrypted`);
    } catch (err) {
      console.error(`  ✗ ${p.email}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nMigrated ${migrated}/${plaintext.length} secrets.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
