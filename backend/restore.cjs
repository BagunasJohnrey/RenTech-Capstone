#!/usr/bin/env node
/**
 * RenTech Database Restore Script
 * 
 * Restores backup JSON files into any PostgreSQL database.
 * 
 * Usage:
 *   node restore.cjs <DATABASE_URL>
 *   node restore.cjs postgresql://user:pass@host:5432/dbname
 *   node restore.cjs postgresql://user:pass@host:5432/dbname --truncate
 *   node restore.cjs postgresql://user:pass@host:5432/dbname --schema-only
 *   node restore.cjs postgresql://user:pass@host:5432/dbname --data-only
 * 
 * Flags:
 *   --schema-only   Only create tables (no data import)
 *   --data-only     Only import data (skip table creation)
 *   --truncate      Clear existing data before importing
 *   --skip-existing Skip tables that already have data
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'backup');

// DDL to create all tables (from supabase_schema.sql, compatible with any PostgreSQL)
const SCHEMA_SQL = `
-- Enums
DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('Admin', 'Staff', 'Customer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ItemStatus" AS ENUM ('Available', 'Rented', 'Reserved', 'Cleaning', 'OutOfService', 'Deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TransactionStatus" AS ENUM ('Active', 'Overdue', 'Reserved', 'Returned', 'Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tables (order matters for foreign keys)
CREATE TABLE IF NOT EXISTS "sms_templates" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "business_rules" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "value" TEXT NOT NULL,
  "description" TEXT,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "profiles" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL UNIQUE,
  "email" TEXT NOT NULL UNIQUE,
  "role" "Role" NOT NULL DEFAULT 'Customer',
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "address" TEXT,
  "preferences" TEXT,
  "notify_prefs" JSONB,
  "style_notes" TEXT,
  "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
  "totp_secret" TEXT,
  "backup_codes" JSONB,
  "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "status" "ItemStatus" NOT NULL DEFAULT 'Available',
  "image" TEXT,
  "description" TEXT,
  "size" TEXT,
  "on_sale" BOOLEAN NOT NULL DEFAULT false,
  "discount_pct" DOUBLE PRECISION,
  "sale_price" DOUBLE PRECISION,
  "sale_ends_at" TIMESTAMPTZ,
  "out_of_service_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "discount_pct" DOUBLE PRECISION NOT NULL,
  "max_uses" INTEGER,
  "current_uses" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "transactions" (
  "id" TEXT PRIMARY KEY,
  "tx_number" SERIAL,
  "customer_id" TEXT NOT NULL REFERENCES "profiles"("id"),
  "processed_by_id" TEXT REFERENCES "profiles"("id"),
  "item_id" INTEGER NOT NULL REFERENCES "inventory_items"("id"),
  "promo_code_id" TEXT REFERENCES "promo_codes"("id"),
  "rental_date" TIMESTAMPTZ NOT NULL,
  "due_date" TIMESTAMPTZ NOT NULL,
  "return_date" TIMESTAMPTZ,
  "status" "TransactionStatus" NOT NULL DEFAULT 'Active',
  "rental_fee" DOUBLE PRECISION NOT NULL,
  "downpayment" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "late_penalty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "damage_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "balance" DOUBLE PRECISION NOT NULL,
  "condition_photo" TEXT,
  "release_photo" TEXT,
  "return_photo" TEXT,
  "due_reminder_sent" BOOLEAN NOT NULL DEFAULT false,
  "no_show_notified" BOOLEAN NOT NULL DEFAULT false,
  "overdue_sms_sent" BOOLEAN NOT NULL DEFAULT false,
  "overdue_sms_retried" BOOLEAN NOT NULL DEFAULT false,
  "overdue_escalation_sent" BOOLEAN NOT NULL DEFAULT false,
  "damage_reason" TEXT,
  "notes" TEXT,
  "size" TEXT,
  "measurements" JSONB,
  "payment_intent_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "payments" (
  "id" TEXT PRIMARY KEY,
  "transaction_id" TEXT NOT NULL REFERENCES "transactions"("id"),
  "amount" DOUBLE PRECISION NOT NULL,
  "method" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "paymongo_pi_id" TEXT UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT PRIMARY KEY,
  "profile_id" TEXT NOT NULL REFERENCES "profiles"("id"),
  "transaction_id" TEXT REFERENCES "transactions"("id"),
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sent_sms" (
  "id" TEXT PRIMARY KEY,
  "profile_id" TEXT NOT NULL REFERENCES "profiles"("id"),
  "sent_by_id" TEXT REFERENCES "profiles"("id"),
  "transaction_id" TEXT REFERENCES "transactions"("id"),
  "template_id" TEXT REFERENCES "sms_templates"("id"),
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'sent',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT PRIMARY KEY,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "performed_by_id" TEXT,
  "old_value" JSONB,
  "new_value" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sequences
SELECT setval(pg_get_serial_sequence('inventory_items', 'id'), COALESCE((SELECT MAX("id") FROM "inventory_items"), 1));
SELECT setval(pg_get_serial_sequence('transactions', 'tx_number'), COALESCE((SELECT MAX("tx_number") FROM "transactions"), 1));
`;

// Insert order (respects FK dependencies)
const INSERT_ORDER = [
  'sms_templates',
  'business_rules',
  'profiles',
  'inventory_items',
  'promo_codes',
  'transactions',
  'payments',
  'notifications',
  'sent_sms',
  'audit_logs',
];

// Auto-increment columns that need sequence reset after insert
const SERIAL_COLUMNS = {
  inventory_items: 'id',
  transactions: 'tx_number',
};

function escapeSql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return "'" + value.replace(/'/g, "''") + "'";
  }
  if (typeof value === 'object') {
    return "'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb";
  }
  return "'" + String(value).replace(/'/g, "''") + "'";
}

async function main() {
  const args = process.argv.slice(2);
  const dbUrl = args.find(a => a.startsWith('postgresql'));
  const flags = args.filter(a => a.startsWith('--'));

  if (!dbUrl) {
    console.error('Usage: node restore.cjs <DATABASE_URL> [--schema-only] [--data-only] [--truncate] [--skip-existing]');
    process.exit(1);
  }

  const schemaOnly = flags.includes('--schema-only');
  const dataOnly = flags.includes('--data-only');
  const truncate = flags.includes('--truncate');
  const skipExisting = flags.includes('--skip-existing');

  // Create a Prisma client pointed at the target database
  const p = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  await p.$connect();

  console.log('=== RenTech Database Restore ===\n');

  // Step 1: Create schema
  if (!dataOnly) {
    console.log('Creating tables...');
    const statements = SCHEMA_SQL.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      try {
        await p.$executeRawUnsafe(stmt);
      } catch (e) {
        if (!e.message.includes('already exists')) {
          console.error(`  Warning: ${e.message.substring(0, 100)}`);
        }
      }
    }
    console.log('  Tables ready.\n');
    if (schemaOnly) {
      console.log('Schema-only mode. Done.');
      await p.$disconnect();
      return;
    }
  }

  // Step 2: Import data
  if (!fs.existsSync(BACKUP_DIR)) {
    console.error(`Backup directory not found: ${BACKUP_DIR}`);
    process.exit(1);
  }

  const manifestPath = path.join(BACKUP_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('manifest.json not found in backup directory');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`Backup from: ${manifest.timestamp}\n`);

  for (const tableName of INSERT_ORDER) {
    const tableInfo = manifest.tables[tableName];
    if (!tableInfo || !tableInfo.rows || tableInfo.rows === 0) {
      console.log(`  ${tableName}: skipped (no data in backup)`);
      continue;
    }

    const filePath = path.join(BACKUP_DIR, tableInfo.file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ${tableName}: skipped (file not found)`);
      continue;
    }

    // Check if table already has data
    if (skipExisting) {
      try {
        const countResult = await p.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
        if (countResult[0].cnt > 0) {
          console.log(`  ${tableName}: skipped (already has ${countResult[0].cnt} rows)`);
          continue;
        }
      } catch (e) {
        // Table might not exist yet, that's fine
      }
    }

    // Truncate if requested
    if (truncate) {
      try {
        await p.$executeRawUnsafe(`TRUNCATE TABLE "${tableName}" CASCADE`);
        console.log(`  ${tableName}: truncated`);
      } catch (e) {
        // FK dependency, will be handled by order
      }
    }

    const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`  ${tableName}: importing ${rows.length} rows...`);

    for (const row of rows) {
      const columns = Object.keys(row);
      const colNames = columns.map(c => `"${c}"`).join(', ');
      const values = columns.map(c => escapeSql(row[c])).join(', ');

      const sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${values}) ON CONFLICT ("id") DO NOTHING`;
      try {
        await p.$executeRawUnsafe(sql);
      } catch (e) {
        // Try without ON CONFLICT for tables without explicit PK conflict handling
        try {
          const sqlNoConflict = `INSERT INTO "${tableName}" (${colNames}) VALUES (${values})`;
          await p.$executeRawUnsafe(sqlNoConflict);
        } catch (e2) {
          console.error(`    Row error in ${tableName}: ${e2.message.substring(0, 120)}`);
        }
      }
    }

    // Reset sequences
    if (SERIAL_COLUMNS[tableName]) {
      try {
        const col = SERIAL_COLUMNS[tableName];
        await p.$executeRawUnsafe(
          `SELECT setval(pg_get_serial_sequence('${tableName}', '${col}'), COALESCE((SELECT MAX("${col}") FROM "${tableName}"), 1))`
        );
      } catch (e) {
        // Not all tables have sequences
      }
    }

    console.log(`    Done.`);
  }

  console.log('\n=== Restore complete ===');
  await p.$disconnect();
}

main().catch(e => {
  console.error('Restore failed:', e);
  process.exit(1);
});
