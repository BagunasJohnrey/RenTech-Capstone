# Backups — RenTech

RenTech's data is Postgres on **Supabase**. Disaster recovery is **platform-managed** (PITR/daily backups); the repo also has a one-click JSON export + history (see "One-click backup" below).

## Where backups live

- **Provider:** Supabase (Postgres). Dashboard → the project tp. **`Database` → `Backups`**.
- **Type:** Point-in-Time Recovery (PITR) / scheduled physical backups, fully managed.
- **Scope:** the whole database (all tables: profiles, inventory_items, transactions, payments, notifications, sentSms, sms_templates, business_rules, promo_codes, audit_logs) plus **Supabase Storage** objects (the private `rentech-images` bucket holds item/release/return photos).

## Retention & cadence

- Supabase **automatic daily backups** are enabled by default on paid tiers.
- Retention follows the project's Supabase plan (Free: ~7 days; Pro: longer) — confirm in the dashboard under Database → Backups and plan settings. **PITR add-on** (Pro) allows roll-back to any point in the retention window.
- **RPO (Recovery Point Objective):** up to 24 h of data loss with daily backups; effectively minutes with PITR enabled.
- **RTO (Recovery Time Objective):** tens of minutes to restore into a new Supabase project, plus the env/points reconfiguration time.

## One-click backup (admin Settings → Data & Backups)

- **Backup now** (`POST /api/settings/backups`, Admin + MFA) collects all tables live via Prisma plus a manifest of every object in both storage buckets (`rentech-catalog` + `rentech-images`: bucket/path/size/updatedAt) and writes `backend/data/backups/backup-<stamp>-<rand>.json` (override dir with `BACKUP_DATA_DIR`). The file downloads immediately. The manifest is metadata only — image binaries stay in Supabase (use `backend/backup-storage.cjs` for a binary copy); a storage blip marks the manifest `incomplete` instead of failing the backup.
- **Cloud copy (automatic, survives restarts)**: every backup is also uploaded to the private `rentech-backups` bucket (`STORAGE_BACKUP_BUCKET` override, auto-created on startup) as `<id>.json` + a tiny `<id>.meta.json` sidecar. The history list merges server + cloud (badges: `cloud ✓` / `cloud only` / `server only`); downloads fall back to the cloud copy when the local file is gone. Last 30 cloud copies are kept.
- **Daily automatic backup**: `index.ts` runs `runAutoBackup()` 10 min after startup and every 24h (skips when `auto_backup_last_run` BusinessRule is within 24h, so restarts never double-run; audited as `backup.auto`). No cron or button-press needed.
- **Last backups** (`GET /api/settings/backups`, Admin + MFA) lists the newest 20 with timestamp, row count, image count and size; each row re-downloads via `GET /api/settings/backups/:id/download`. Rows stuck at `server only` get a **To cloud** retry button (`POST /api/settings/backups/:id/upload`, audited as `backup.upload`); a retry that still fails returns 502 and logs the Supabase reason server-side (`[backups] cloud upload of <id> …`).
- **Import / restore** (`POST /api/settings/backups/import`, Admin + MFA): pick a downloaded JSON in Settings → Data & Backups → Import, preview its per-table counts, confirm. The server validates + sanitizes every row and upserts in FK order (rules → templates → profiles → promos → items → transactions → payments/notifications/SMS/audit). Safety: rows with a missing customer/item are skipped (never force-inserted); `txNumber` is never written (autoincrement); your own admin role can never be demoted by a restore; image binaries are NOT restored (manifest only — re-upload or re-run the storage seed if buckets were wiped).
- **Auditing**: backup create/download/import each write an `audit_logs` row (`backup.create` / `backup.download` / `backup.import` with the summary), and the `audit_logs` table itself is part of every backup.
- **Where history lives**: the backup list and the saved-reports list each blend server files (`backend/data/…`, git-ignored) with their cloud bucket — the cloud copy is the durable one. No migration was needed and the DB stays lean. Supabase PITR remains the disaster-recovery source of truth.
- **Saved AI reports**: every `POST /api/ai/generate-report` auto-saves to `backend/data/ai-reports/` (`AI_REPORTS_DIR` override, newest 20 kept) AND to the private `rentech-ai-reports` cloud bucket (`STORAGE_AI_REPORTS_BUCKET` override, auto-created on startup, last 20 kept); `GET /api/ai/reports` + `GET /api/ai/reports/:id` (Admin) merge server + cloud with `cloud ✓` / `cloud only` / `server only` badges, and reopening falls back to the cloud copy. Power the "Last saved reports" lists in Settings → Data & Backups and Business Intelligence.
- `backend/data/` is git-ignored (live PII) — copy files off the server for offsite keeps.

## Enable / verify

1. Open the Supabase project for RenTech.
2. **Database → Backups** → confirm a scheduled daily backup is present (it is on paid tiers).
3. (Recommended on Pro) enable **Point-in-Time Recovery** and note the retention window in the dashboard.
4. (Optional extra safety) set up a weekly `pg_dump` script downloaded to the owner's machine — Supabase also provides the connection string in `Project Settings → Database`. Example (`pg_dump`) run: `pg_dump -h db.<ref>.supabase.co -U postgres -Fc -f rentech_backup_<date>.dump` (note: pooler port 6543/PgBouncer does not run DDL/dump; use the direct `:5432` connection for dumps — see AGENTS.md).

## Restore procedure

1. In the Supabase dashboard: **Database → Backups** → choose the restore point (latest daily backup or a PITR timestamp).
2. Click **Restore** and create a **new project** from that backup (do NOT destructively restore over the live production project during an incident unless that's the explicit call — a fresh restore project is safer).
3. On the new/restore project:
   - Update `backend/.env` `DATABASE_URL` to point at the restored DB (and the Supabase `SUPABASE_URL`/keys for that project if it changed).
   - Re-run `npx prisma db push` only if the restored schema is behind the app's `prisma/schema.prisma` (otherwise leave it alone).
   - Confirm Storage bucket + files exist (item/release/return images). If Storage wasn't part of the backup scope, images will be missing — recreate them from any available copies.
4. Smoke-check: `GET /api/health` → 200; login → works; Booking flow → one create/release/return works.
5. Point the frontend/admin back to the restored backend once confirmed healthy.

## What's NOT backed up by this mechanism

- **Frontend build artifacts** (`frontend/dist/`) — regenerate with `npm run build`.
- **Environment secrets** (`.env`) — keep a separate, encrypted copy of production env keys outside the repo.
- **Local simulation state** — dev-simulated SMS/payments are not real data and do not need backup.

## Cadence of review

Verify database backups monthly in the dashboard (look at the latest snapshot date) and after any major schema change (e.g. new Prisma fields) before going live.
