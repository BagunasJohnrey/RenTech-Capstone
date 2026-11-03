/**
 * One-time copy of every image object from Supabase Storage to Cloudflare R2.
 *
 * Keys are copied VERBATIM, so nothing in the database changes — `item.image`,
 * avatars, payment proofs and condition photos all keep their stored paths;
 * only the host that serves them moves.
 *
 *   Supabase STORAGE_CATALOG_BUCKET (public)  -> R2_CATALOG_BUCKET
 *   Supabase STORAGE_BUCKET (private, rental/) -> R2_PRIVATE_BUCKET
 *   Supabase backups / AI reports / promo suggestions -> R2_PRIVATE_BUCKET
 *     under backups/, ai-reports/, ai-promo-suggestions/
 *
 * Idempotent: objects already present in R2 are skipped (HEAD), so it can be
 * re-run after a partial failure. Supabase objects are NOT deleted — remove
 * them by hand once the app has run on R2 for a while.
 *
 * Note: downloading counts once against Supabase egress (a few hundred small
 * WebPs — tens of MB), which is fine even in the grace period.
 *
 * Usage (from backend/, with SUPABASE_* and R2_* set in .env):
 *   npx tsx scripts/migrate-storage-to-r2.ts --dry-run   # list what would copy
 *   npx tsx scripts/migrate-storage-to-r2.ts             # copy
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/config/supabase.js';
import { r2CatalogBucket, r2PrivateBucket, r2PutObject, r2ObjectExists } from '../src/services/r2.client.js';

const DRY_RUN = process.argv.includes('--dry-run');
const CACHE = 'public, max-age=2592000, immutable';

if (!process.env.R2_ACCOUNT_ID && !process.env.R2_ENDPOINT) {
  console.error('Missing R2_ENDPOINT (or R2_ACCOUNT_ID) in backend/.env');
  process.exit(1);
}
for (const k of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[k]) {
    console.error(`Missing ${k} in backend/.env`);
    process.exit(1);
  }
}

const PAIRS: Array<{ from: string; to: string; prefix?: string; json?: boolean }> = [
  { from: process.env.STORAGE_CATALOG_BUCKET || 'rentech-catalog', to: r2CatalogBucket() },
  { from: process.env.STORAGE_BUCKET || 'rentech-images', to: r2PrivateBucket() },
  // Backup / AI report / promo-suggestion history -> prefixes in the private bucket.
  { from: process.env.STORAGE_BACKUP_BUCKET || 'rentech-backups', to: r2PrivateBucket(), prefix: 'backups/', json: true },
  { from: process.env.STORAGE_AI_REPORTS_BUCKET || 'rentech-ai-reports', to: r2PrivateBucket(), prefix: 'ai-reports/', json: true },
  { from: process.env.STORAGE_PROMO_SUGGESTIONS_BUCKET || 'rentech-ai-promo-suggestions', to: r2PrivateBucket(), prefix: 'ai-promo-suggestions/', json: true },
];

type Entry = { name: string; id?: string | null };

async function listAll(bucket: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    const rows = (data ?? []) as Entry[];
    for (const e of rows) {
      const full = prefix ? `${prefix}${e.name}` : e.name;
      if (e.id == null) out.push(...(await listAll(bucket, `${full}/`)));
      else if (e.name !== '.emptyFolderPlaceholder') out.push(full);
    }
    if (rows.length < 100) break;
  }
  return out;
}

async function main() {
  let copied = 0, skipped = 0, failed = 0;
  for (const { from, to, prefix = '', json } of PAIRS) {
    let keys: string[];
    try {
      keys = await listAll(from);
    } catch (err) {
      console.log(`
${from}: skipped (${(err as Error).message})`);
      continue;
    }
    console.log(`\n${from} -> R2 ${to}: ${keys.length} objects`);
    for (const key of keys) {
      try {
        const dest = `${prefix}${key}`;
        if (await r2ObjectExists(to, dest)) { skipped++; continue; }
        if (DRY_RUN) { console.log('  would copy', key); copied++; continue; }
        const { data, error } = await supabaseAdmin.storage.from(from).download(key);
        if (error || !data) throw new Error(error?.message || 'empty download');
        const buf = Buffer.from(await data.arrayBuffer());
        const type = data.type || (key.endsWith('.webp') ? 'image/webp' : key.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        await r2PutObject(to, dest, buf, type, json ? 'private, no-store' : CACHE);
        copied++;
        if (copied % 25 === 0) console.log(`  …${copied} copied`);
      } catch (err) {
        failed++;
        console.error('  FAILED', key, (err as Error).message);
      }
    }
  }
  console.log(`\nDone${DRY_RUN ? ' (dry run)' : ''}: ${copied} ${DRY_RUN ? 'to copy' : 'copied'}, ${skipped} already in R2, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
