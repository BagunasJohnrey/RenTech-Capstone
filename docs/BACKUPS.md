# Backups — RenTech

RenTech's data is Postgres on **Supabase**. Backups are **platform-managed**, not app-managed, so there is no backup code in this repo. This page documents how backups are enabled and how to restore.

## Where backups live

- **Provider:** Supabase (Postgres). Dashboard → the project tp. **`Database` → `Backups`**.
- **Type:** Point-in-Time Recovery (PITR) / scheduled physical backups, fully managed.
- **Scope:** the whole database (all tables: profiles, inventory_items, transactions, payments, notifications, sentSms, sms_templates, business_rules, promo_codes, audit_logs) plus **Supabase Storage** objects (the private `rentech-images` bucket holds item/release/return photos).

## Retention & cadence

- Supabase **automatic daily backups** are enabled by default on paid tiers.
- Retention follows the project's Supabase plan (Free: ~7 days; Pro: longer) — confirm in the dashboard under Database → Backups and plan settings. **PITR add-on** (Pro) allows roll-back to any point in the retention window.
- **RPO (Recovery Point Objective):** up to 24 h of data loss with daily backups; effectively minutes with PITR enabled.
- **RTO (Recovery Time Objective):** tens of minutes to restore into a new Supabase project, plus the env/points reconfiguration time.

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
