# RenTech Database Backup & Restore Guide

## Overview

This guide covers backing up and restoring the RenTech (Mylene's Boutique) database, including table data and Supabase Storage images.

**Backup location:** `C:\Users\johnr\RenTech - Capstone\backup\`

---

## What's Included

### Database tables (JSON)
| Table | Description |
|---|---|
| `profiles` | Admin, Staff, Customer accounts |
| `inventory_items` | 59 rental items (Gown, Barong, Filipiniana) |
| `business_rules` | Business config (fees, penalties, name) |
| `sms_templates` | Booking, late return, due reminder templates |
| `promo_codes` | Discount codes |
| `transactions` | Rental transactions |
| `payments` | Payment records |
| `notifications` | In-app notifications |
| `sent_sms` | SMS history |
| `audit_logs` | Audit trail |

### Storage images
- 59 item photos in Supabase Storage bucket `rentech-images`
- Backed up separately (requires working Supabase connection)

---

## Prerequisites

- Node.js installed
- `.env` file in `backend/` with database credentials
- For storage scripts: Supabase DNS must be working

---

## Scripts

All scripts are in `backend/` and run with Node.js.

### 1. Database Backup (`backup.cjs`)

Dumps all table data to JSON files in `backup/`.

```bash
cd backend
node backup.cjs
```

**Output:** `backup/<table_name>.json` + `backup/manifest.json`

### 2. Database Restore (`restore.cjs`)

Restores backup JSON files into any PostgreSQL database.

```bash
# Create tables only (no data)
cd backend
node restore.cjs postgresql://user:pass@host:5432/newdb --schema-only

# Import data only (tables must exist)
node restore.cjs postgresql://user:pass@host:5432/newdb --data-only

# Full restore (create tables + import data)
node restore.cjs postgresql://user:pass@host:5432/newdb

# Clear existing data first, then import
node restore.cjs postgresql://user:pass@host:5432/newdb --truncate

# Skip tables that already have data
node restore.cjs postgresql://user:pass@host:5432/newdb --skip-existing
```

**Flags:**
| Flag | Description |
|---|---|
| `--schema-only` | Only create tables, enums, and sequences |
| `--data-only` | Only import data (skip table creation) |
| `--truncate` | Clear existing data before importing |
| `--skip-existing` | Skip tables that already have rows |

### 3. Storage Backup (`backup-storage.cjs`)

Downloads all images from Supabase Storage to `backup/storage/`.

```bash
cd backend
node backup-storage.cjs
```

**Note:** Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. Supabase DNS must be working.

**Output:** `backup/storage/<image_name>.jpg`

### 4. Storage Restore (`restore-storage.cjs`)

Uploads images from `backup/storage/` back to Supabase Storage.

```bash
cd backend

# Upload only new files
node restore-storage.cjs

# Re-upload everything (overwrite existing)
node restore-storage.cjs --overwrite
```

---

## Full Restore to a New Database

### Scenario: Move to a new Supabase project

1. **Create new Supabase project** at [supabase.com/dashboard](https://supabase.com/dashboard)

2. **Update `.env`** with new project credentials:
   ```
   SUPABASE_URL=https://<new-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<new-key>
   SUPABASE_ANON_KEY=<new-key>
   DATABASE_URL=postgresql://postgres.<new-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
   DIRECT_URL=postgresql://postgres:<password>@db.<new-ref>.supabase.co:5432/postgres
   ```

3. **Restore database:**
   ```bash
   cd backend
   node restore.cjs postgresql://postgres.<new-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

4. **Upload images:**
   ```bash
   node restore-storage.cjs
   ```

5. **Update frontend `.env`:**
   ```
   VITE_SUPABASE_URL=https://<new-ref>.supabase.co
   ```

### Scenario: Move to local PostgreSQL (Docker)

1. **Start PostgreSQL:**
   ```bash
   docker run -d --name rentech-pg -e POSTGRES_PASSWORD=rentech -p 5432:5432 postgres:17
   ```

2. **Restore:**
   ```bash
   node restore.cjs postgresql://postgres:rentech@localhost:5432/postgres
   ```

3. **Update `backend/.env`:**
   ```
   DATABASE_URL=postgresql://postgres:rentech@localhost:5432/postgres
   DIRECT_URL=postgresql://postgres:rentech@localhost:5432/postgres
   ```

### Scenario: Move to a different Supabase region

1. Create new project in target region
2. Follow "Move to new Supabase project" steps above

---

## Backup Schedule

| What | Frequency | Command |
|---|---|---|
| Database data | Weekly / before changes | `node backup.cjs` |
| Storage images | After adding items | `node backup-storage.cjs` |
| Full backup | Before major updates | Both scripts |

---

## Troubleshooting

### "Cannot find module '@prisma/client'"
Run from `backend/` directory (where `node_modules` is):
```bash
cd backend
node backup.cjs
```

### "fetch failed" on storage scripts
Supabase DNS is not resolving. Check:
```bash
nslookup vlidakdroeqpoemzolus.supabase.co 8.8.8.8
```
If it returns NXDOMAIN, the Supabase project is paused or has DNS issues. Wait for it to be restored, or contact Supabase support.

### "relation already exists" during restore
Tables already exist. Use `--data-only` or `--truncate`:
```bash
node restore.cjs <DB_URL> --data-only
```

### "duplicate key value violates unique constraint"
Row already exists. The restore script uses `ON CONFLICT DO NOTHING` by default. Use `--truncate` to replace all data.

### Sequence out of sync after restore
The restore script auto-resets sequences. If IDs are wrong, run:
```sql
SELECT setval(pg_get_serial_sequence('inventory_items', 'id'), (SELECT MAX(id) FROM inventory_items));
SELECT setval(pg_get_serial_sequence('transactions', 'tx_number'), (SELECT MAX(tx_number) FROM transactions));
```

---

## File Structure

```
RenTech - Capstone/
├── backup/
│   ├── manifest.json          # Backup metadata (timestamps, row counts)
│   ├── profiles.json          # 6 user accounts
│   ├── inventory_items.json   # 59 rental items
│   ├── business_rules.json    # 9 business config rules
│   ├── sms_templates.json     # 3 SMS templates
│   ├── transactions.json      # Rental transactions
│   ├── payments.json          # Payment records
│   ├── notifications.json     # In-app notifications
│   ├── sent_sms.json          # SMS history
│   ├── audit_logs.json        # Audit trail
│   ├── promo_codes.json       # Discount codes
│   └── storage/               # Item images (downloaded separately)
│       ├── 1-A-Line-Ball-Gown-1.jpg
│       ├── 2-Ballroom-Ball-Gown-2.jpg
│       └── ...
├── backend/
│   ├── backup.cjs             # Database backup script
│   ├── restore.cjs            # Database restore script
│   ├── backup-storage.cjs     # Storage backup script
│   ├── restore-storage.cjs    # Storage restore script
│   └── .env                   # Database credentials
└── DATABASE_BACKUP_README.md  # This file
```

---

## Notes

- **Enum types** (Role, ItemStatus, TransactionStatus) are created automatically by the restore script
- **Foreign keys** are handled by insert order (profiles → inventory_items → transactions → payments)
- **JSON columns** (notify_prefs, backup_codes, measurements) are preserved as-is
- **Auto-increment sequences** are reset after import to match the data
- **Image paths** in `inventory_items.image` are relative to the `rentech-images` bucket (e.g. `"2-Ballroom-Ball-Gown-2.jpg"`)
