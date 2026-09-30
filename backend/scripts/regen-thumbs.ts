/**
 * Regenerate grid thumbnails at the current IMAGE_THUMB_DIM / IMAGE_THUMB_QUALITY.
 *
 * Background: thumbs generated before the 768px bump are 320x480-era files, so
 * catalog / collection cards render soft until these are rebuilt. The frontend
 * needs no change — thumb URLs stay identical, only the bytes are replaced.
 *
 * For every InventoryItem with a stored (non-absolute) image path: downloads
 * the full image from its bucket, rebuilds the thumb via makeThumb(), and
 * re-uploads with upsert:true (overwrites the old small thumb in place).
 *
 * Usage (from backend/):
 *   npx tsx scripts/regen-thumbs.ts --dry-run   # report current thumb sizes, write nothing
 *   npx tsx scripts/regen-thumbs.ts             # live regen (upsert overwrite)
 *   npx tsx scripts/regen-thumbs.ts --limit 5   # live regen, first 5 items only
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { supabaseAdmin } from '../src/config/supabase.js';
import { bucketFor } from '../src/services/storage.service.js';
import { makeThumb, thumbKeyFor } from '../src/utils/imageCompress.js';
import { env } from '../src/config/env.js';

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1] || limitArg.split(' ')[1] || '0', 10) : 0;

const isAbsoluteUrl = (p: string) =>
  p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:');

async function thumbDims(bucket: string, key: string): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(key);
    if (error || !data) return `missing (${error?.message ?? 'no data'})`;
    const buf = Buffer.from(await (data as Blob).arrayBuffer());
    const { default: sharp } = await import('sharp');
    const meta = await sharp(buf).metadata();
    return `${meta.width}x${meta.height} ${(buf.length / 1024).toFixed(0)}KB`;
  } catch (err) {
    return `unreadable (${(err as Error)?.message})`;
  }
}

async function main() {
  console.log(`=== Thumb regen (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) — target ${env.IMAGE_THUMB_DIM}px q${env.IMAGE_THUMB_QUALITY} ===`);
  const prisma = new PrismaClient();
  try {
    const items = await prisma.inventoryItem.findMany({
      select: { id: true, name: true, image: true },
      orderBy: { id: 'asc' },
    });
    const withImages = items.filter((i) => i.image && !isAbsoluteUrl(i.image as string));
    console.log(`DB has ${items.length} item(s), ${withImages.length} with stored image paths.`);
    const queue = LIMIT > 0 ? withImages.slice(0, LIMIT) : withImages;

    let ok = 0, failed = 0, skipped = 0;
    const failures: string[] = [];

    for (const item of queue) {
      const path = item.image as string;
      const bucket = bucketFor(path);
      const thumbKey = thumbKeyFor(path);

      if (DRY_RUN) {
        const dims = await thumbDims(bucket, thumbKey);
        console.log(`  WOULD REGEN  #${item.id} ${item.name} — thumb ${thumbKey} is ${dims}`);
        ok++;
        continue;
      }

      try {
        const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
        if (error || !data) {
          console.log(`  SKIP  #${item.id} ${item.name} — full image missing (${error?.message ?? 'no data'})`);
          skipped++;
          continue;
        }
        const full = Buffer.from(await (data as Blob).arrayBuffer());
        const thumbBytes = await makeThumb(full);
        const { error: upError } = await supabaseAdmin.storage
          .from(bucket)
          .upload(thumbKey, thumbBytes, { contentType: 'image/webp', upsert: true, cacheControl: '2592000' });
        if (upError) throw new Error(upError.message);
        console.log(`  OK  #${item.id} ${item.name} — ${(thumbBytes.length / 1024).toFixed(0)}KB -> ${thumbKey}`);
        ok++;
      } catch (err) {
        console.log(`  FAILED  #${item.id} ${item.name}: ${(err as Error)?.message}`);
        failures.push(item.name);
        failed++;
      }
    }

    console.log(`\nDone: ${ok} regenerated, ${skipped} skipped, ${failed} failed.`);
    if (failures.length) console.log('Failed:', failures.join('; '));
  } finally {
    await prisma.$disconnect();
  }
  if (DRY_RUN) console.log('(dry run — nothing was written)');
}

main().catch((e) => { console.error(e); process.exit(1); });
