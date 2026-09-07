#!/usr/bin/env node
/**
 * RenTech Storage Restore Script
 * 
 * Uploads images from backup/storage/ to Supabase Storage bucket 'rentech-images'.
 * 
 * Usage: node restore-storage.cjs
 *   node restore-storage.cjs --overwrite   (re-upload even if file exists)
 * 
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const BUCKET_NAME = 'rentech-images';
const STORAGE_DIR = path.join(__dirname, '..', 'backup', 'storage');

// Load env from backend/.env
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return;
  const key = trimmed.substring(0, eqIdx).trim();
  const val = trimmed.substring(eqIdx + 1).trim();
  env[key] = val;
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function main() {
  const args = process.argv.slice(2);
  const overwrite = args.includes('--overwrite');

  if (!fs.existsSync(STORAGE_DIR)) {
    console.error(`Storage directory not found: ${STORAGE_DIR}`);
    console.error('Run backup-storage.cjs first.');
    process.exit(1);
  }

  const files = fs.readdirSync(STORAGE_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f));

  console.log('=== RenTech Storage Restore ===');
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log(`Files to upload: ${files.length}\n`);

  // List existing files in bucket
  const { data: existing } = await supabase.storage.from(BUCKET_NAME).list('');
  const existingNames = new Set((existing || []).map(f => f.name));

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    if (!overwrite && existingNames.has(file)) {
      skipped++;
      continue;
    }

    const filePath = path.join(STORAGE_DIR, file);
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(file).toLowerCase();
    const contentType = ALLOWED_MIME[ext] || 'image/jpeg';

    try {
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(file, buffer, { contentType, upsert: overwrite });

      if (error) {
        console.error(`  FAIL: ${file} - ${error.message}`);
        failed++;
        continue;
      }

      uploaded++;
      if (uploaded % 10 === 0) {
        console.log(`  Uploaded ${uploaded}...`);
      }
    } catch (e) {
      console.error(`  FAIL: ${file} - ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== Storage restore complete ===`);
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total files: ${files.length}`);
}

main().catch(e => {
  console.error('Storage restore failed:', e);
  process.exit(1);
});
