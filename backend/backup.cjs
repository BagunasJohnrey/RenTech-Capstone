#!/usr/bin/env node
/**
 * RenTech Database Backup Script
 * 
 * Dumps all table data from the database to JSON files in ./backup/
 * Usage: node backup.cjs
 * 
 * Connects using DATABASE_URL from backend/.env
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'backup');

// Table query order (respects foreign key dependencies)
const TABLES = [
  {
    name: 'sms_templates',
    sql: 'SELECT * FROM sms_templates ORDER BY created_at',
  },
  {
    name: 'business_rules',
    sql: 'SELECT * FROM business_rules ORDER BY "key"',
  },
  {
    name: 'profiles',
    sql: 'SELECT * FROM profiles ORDER BY created_at',
  },
  {
    name: 'inventory_items',
    sql: 'SELECT * FROM inventory_items ORDER BY id',
  },
  {
    name: 'promo_codes',
    sql: 'SELECT * FROM promo_codes ORDER BY created_at',
  },
  {
    name: 'transactions',
    sql: 'SELECT * FROM transactions ORDER BY created_at',
  },
  {
    name: 'payments',
    sql: 'SELECT * FROM payments ORDER BY created_at',
  },
  {
    name: 'notifications',
    sql: 'SELECT * FROM notifications ORDER BY created_at',
  },
  {
    name: 'sent_sms',
    sql: 'SELECT * FROM sent_sms ORDER BY created_at',
  },
  {
    name: 'audit_logs',
    sql: 'SELECT * FROM audit_logs ORDER BY created_at',
  },
];

async function main() {
  const p = new PrismaClient();
  await p.$connect();

  // Create backup directory
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const manifest = {
    timestamp: new Date().toISOString(),
    tables: {},
  };

  console.log('=== RenTech Database Backup ===\n');

  for (const table of TABLES) {
    try {
      const rows = await p.$queryRawUnsafe(table.sql);

      // Serialize dates and JSON properly
      const serialized = rows.map(row => {
        const obj = {};
        for (const [key, value] of Object.entries(row)) {
          if (value instanceof Date) {
            obj[key] = value.toISOString();
          } else if (typeof value === 'object' && value !== null) {
            obj[key] = JSON.parse(JSON.stringify(value));
          } else {
            obj[key] = value;
          }
        }
        return obj;
      });

      const filePath = path.join(BACKUP_DIR, `${table.name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2), 'utf8');

      manifest.tables[table.name] = {
        rows: serialized.length,
        file: `${table.name}.json`,
      };

      console.log(`  ${table.name}: ${serialized.length} rows -> backup/${table.name}.json`);
    } catch (e) {
      console.error(`  ${table.name}: ERROR - ${e.message}`);
      manifest.tables[table.name] = { rows: 0, error: e.message };
    }
  }

  // Write manifest
  const manifestPath = path.join(BACKUP_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\n  manifest.json written`);

  // Summary
  const totalRows = Object.values(manifest.tables).reduce((sum, t) => sum + (t.rows || 0), 0);
  console.log(`\n=== Backup complete: ${totalRows} total rows across ${Object.keys(manifest.tables).length} tables ===`);
  console.log(`  Location: ${BACKUP_DIR}`);

  await p.$disconnect();
}

main().catch(e => {
  console.error('Backup failed:', e);
  process.exit(1);
});
