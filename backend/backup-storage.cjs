#!/usr/bin/env node
/**
 * RenTech Storage Backup Script
 * 
 * Downloads all images from Supabase Storage bucket 'rentech-images'
 * into backup/storage/ directory.
 * 
 * Usage: node backup-storage.cjs
 * 
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 * NOTE: Supabase DNS must be working (vlidakdroeqpoemzolus.supabase.co must resolve)
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

async function main() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  console.log('=== RenTech Storage Backup ===');
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log(`Output: ${STORAGE_DIR}\n`);

  // List all files in the bucket (recursive)
  let allFiles = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).list('', {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error) {
      console.error('Failed to list bucket:', error.message);
      console.error('\nMake sure Supabase DNS is working (vlidakdroeqpoemzolus.supabase.co must resolve).');
      process.exit(1);
    }

    if (!data || data.length === 0) break;
    allFiles = allFiles.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`Found ${allFiles.length} files in bucket.\n`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of allFiles) {
    const filePath = path.join(STORAGE_DIR, file.name);

    // Skip if already downloaded
    if (fs.existsSync(filePath) && fs.statSync(filePath).size === file.metadata?.size) {
      skipped++;
      continue;
    }

    try {
      const { data, error } = await supabase.storage.from(BUCKET_NAME).download(file.name);
      if (error) {
        console.error(`  FAIL: ${file.name} - ${error.message}`);
        failed++;
        continue;
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
      downloaded++;

      if (downloaded % 10 === 0) {
        console.log(`  Downloaded ${downloaded}...`);
      }
    } catch (e) {
      console.error(`  FAIL: ${file.name} - ${e.message}`);
      failed++;
    }
  }

  console.log(`\n=== Storage backup complete ===`);
  console.log(`  Downloaded: ${downloaded}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total files: ${allFiles.length}`);
  console.log(`  Location: ${STORAGE_DIR}`);
}

main().catch(e => {
  console.error('Storage backup failed:', e);
  process.exit(1);
});
