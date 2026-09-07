-- ============================================================================
-- RenTech (Mylene's Boutique) — Full Supabase SQL setup
-- ============================================================================
-- What this is:
--   Complete, fresh-install schema for the RenTech app, derived 1:1 from
--   backend/prisma/schema.prisma + backend/prisma/seed.ts.
--   Covers all 10 app tables, 3 enums, indexes, foreign keys, required seeds,
--   and the private storage bucket row.
--
-- How to run:
--   1. Supabase Dashboard -> pick your project -> SQL Editor -> New query
--   2. Paste this ENTIRE file -> Run (takes ~5-10s on a fresh project)
--   3. Re-run is safe (all statements are IF NOT EXISTS / ON CONFLICT guarded,
--      FKs are DROP-IF-EXISTS then re-added)
--   4. Verify with the checks at the bottom of this file
--
-- After running:
--   - Storage: Dashboard -> Storage should show private bucket `rentech-images`.
--     (The backend also auto-creates it on boot via ensureBucket(), so if the
--     storage INSERT below fails on your Supabase version, just create a
--     private bucket named `rentech-images` in the UI and ignore that error.)
--   - Auth: Dashboard -> Authentication -> Providers -> Email: enable
--     "Confirm email". The app's signup flow (AUTH_EMAIL_CONFIRM=false)
--     relies on Supabase sending the confirmation link with redirect to
--     /verify-email.
--   - Backend .env: point DATABASE_URL (pooler :6543, user postgres.<ref>)
--     and DIRECT_URL (direct :5432, user postgres) at this project, then
--     `npx prisma db pull` should show zero drift.
--   - Prisma clients do NOT need regenerating — no schema change, this only
--     recreates in SQL what Prisma already expects.
--
-- Notes:
--   - profiles.user_id references auth.users.id logically (Supabase Auth owns
--     that table). There is deliberately NO database FK to auth.users — the
--     backend creates the profile row right after the auth user. Do not add one.
--   - updated_at columns are maintained by Prisma (@updatedAt), no triggers.
--   - gen_random_uuid() defaults are a convenience for manual SQL inserts;
--     Prisma always supplies its own ids and is unaffected.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Enums (idempotent — safe to re-run)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

-- Profiles (customers + staff + admins; 1 row per Supabase auth user)
CREATE TABLE IF NOT EXISTS "profiles" (
  "id"                   TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "user_id"              TEXT NOT NULL,
  "email"                TEXT NOT NULL,
  "role"                 "Role" NOT NULL DEFAULT 'Customer',
  "name"                 TEXT NOT NULL,
  "phone"                TEXT,
  "address"              TEXT,
  "preferences"          TEXT,
  "notify_prefs"         JSONB,
  "style_notes"          TEXT,
  "mfa_enabled"          BOOLEAN NOT NULL DEFAULT false,
  "totp_secret"          TEXT,
  "backup_codes"         JSONB,
  "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- Inventory (rental catalog; image = private-bucket path OR absolute URL)
CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id"                    SERIAL NOT NULL,
  "name"                  TEXT NOT NULL,
  "category"              TEXT NOT NULL,
  "price"                 DOUBLE PRECISION NOT NULL,
  "status"                "ItemStatus" NOT NULL DEFAULT 'Available',
  "image"                 TEXT,
  "description"           TEXT,
  "size"                  TEXT,
  "on_sale"               BOOLEAN NOT NULL DEFAULT false,
  "discount_pct"          DOUBLE PRECISION,
  "sale_price"            DOUBLE PRECISION,
  "sale_ends_at"          TIMESTAMP(3),
  "out_of_service_reason" TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- Transactions (bookings / rentals; tx_number = human-friendly sequence)
CREATE TABLE IF NOT EXISTS "transactions" (
  "id"                      TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "tx_number"               SERIAL NOT NULL,
  "customer_id"             TEXT NOT NULL,
  "processed_by_id"         TEXT,
  "item_id"                 INTEGER NOT NULL,
  "promo_code_id"           TEXT,
  "rental_date"             TIMESTAMP(3) NOT NULL,
  "due_date"                TIMESTAMP(3) NOT NULL,
  "return_date"             TIMESTAMP(3),
  "status"                  "TransactionStatus" NOT NULL DEFAULT 'Active',
  "rental_fee"              DOUBLE PRECISION NOT NULL,
  "downpayment"             DOUBLE PRECISION NOT NULL DEFAULT 0,
  "late_penalty"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "damage_fee"              DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_paid"              DOUBLE PRECISION NOT NULL DEFAULT 0,
  "balance"                 DOUBLE PRECISION NOT NULL,
  "condition_photo"         TEXT,
  "release_photo"           TEXT,
  "return_photo"            TEXT,
  "due_reminder_sent"       BOOLEAN NOT NULL DEFAULT false,
  "no_show_notified"        BOOLEAN NOT NULL DEFAULT false,
  "overdue_sms_sent"        BOOLEAN NOT NULL DEFAULT false,
  "overdue_sms_retried"     BOOLEAN NOT NULL DEFAULT false,
  "overdue_escalation_sent" BOOLEAN NOT NULL DEFAULT false,
  "damage_reason"           TEXT,
  "notes"                   TEXT,
  "size"                    TEXT,
  "measurements"            JSONB,
  "payment_intent_id"       TEXT,
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- Promo codes
CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "code"         TEXT NOT NULL,
  "discount_pct" DOUBLE PRECISION NOT NULL,
  "max_uses"     INTEGER,
  "current_uses" INTEGER NOT NULL DEFAULT 0,
  "expires_at"   TIMESTAMP(3),
  "is_active"    BOOLEAN NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- Payments (one row per downpayment / balance / fee payment)
CREATE TABLE IF NOT EXISTS "payments" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "transaction_id" TEXT NOT NULL,
  "amount"         DOUBLE PRECISION NOT NULL,
  "method"         TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "paymongo_pi_id" TEXT,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- In-app notifications
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "profile_id"     TEXT NOT NULL,
  "transaction_id" TEXT,
  "type"           TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "message"        TEXT NOT NULL,
  "is_read"        BOOLEAN NOT NULL DEFAULT false,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- SMS send history
CREATE TABLE IF NOT EXISTS "sent_sms" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "profile_id"     TEXT NOT NULL,
  "sent_by_id"     TEXT,
  "transaction_id" TEXT,
  "template_id"    TEXT,
  "message"        TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'sent',
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sent_sms_pkey" PRIMARY KEY ("id")
);

-- SMS templates (seeded below; editable in Settings)
CREATE TABLE IF NOT EXISTS "sms_templates" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "name"       TEXT NOT NULL,
  "content"    TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id")
);

-- Business rules (key/value settings; seeded below; editable in Settings)
CREATE TABLE IF NOT EXISTS "business_rules" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "key"         TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "description" TEXT,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_rules_pkey" PRIMARY KEY ("id")
);

-- Audit log (append-only; pruned by retention job after data_retention_months)
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "action"          TEXT NOT NULL,
  "entity"          TEXT NOT NULL,
  "entity_id"       TEXT NOT NULL,
  "performed_by_id" TEXT,
  "old_value"       JSONB,
  "new_value"       JSONB,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------------------------
-- 2b. Patches for DBs created from the OLD squashed baseline
--      (CREATE TABLE IF NOT EXISTS above is a no-op when the table already
--      exists, so these ALTERs bring old tables up to the current schema)
-- ----------------------------------------------------------------------------
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "preferences" TEXT;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "notify_prefs" JSONB;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "style_notes" TEXT;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "totp_secret" TEXT;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "backup_codes" JSONB;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "size" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "on_sale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "discount_pct" DOUBLE PRECISION;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "sale_price" DOUBLE PRECISION;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "sale_ends_at" TIMESTAMP(3);
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "out_of_service_reason" TEXT;

-- ----------------------------------------------------------------------------
-- 3. Unique constraints + indexes (IF NOT EXISTS — safe to re-run)
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_user_id_key" ON "profiles"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_email_key" ON "profiles"("email");

CREATE INDEX IF NOT EXISTS "inventory_items_name_category_status_idx" ON "inventory_items"("name", "category", "status");

CREATE INDEX IF NOT EXISTS "transactions_item_id_status_idx" ON "transactions"("item_id", "status");
CREATE INDEX IF NOT EXISTS "transactions_customer_id_status_idx" ON "transactions"("customer_id", "status");
CREATE INDEX IF NOT EXISTS "transactions_status_due_date_idx" ON "transactions"("status", "due_date");
CREATE INDEX IF NOT EXISTS "transactions_processed_by_id_idx" ON "transactions"("processed_by_id");
CREATE INDEX IF NOT EXISTS "transactions_created_at_idx" ON "transactions"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_code_key" ON "promo_codes"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "payments_paymongo_pi_id_key" ON "payments"("paymongo_pi_id");
CREATE INDEX IF NOT EXISTS "payments_transaction_id_idx" ON "payments"("transaction_id");
CREATE INDEX IF NOT EXISTS "payments_created_at_idx" ON "payments"("created_at");

CREATE INDEX IF NOT EXISTS "notifications_profile_id_is_read_idx" ON "notifications"("profile_id", "is_read");
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications"("created_at");

CREATE INDEX IF NOT EXISTS "sent_sms_profile_id_idx" ON "sent_sms"("profile_id");
CREATE INDEX IF NOT EXISTS "sent_sms_created_at_idx" ON "sent_sms"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "business_rules_key_key" ON "business_rules"("key");

-- ----------------------------------------------------------------------------
-- 4. Foreign keys (drop-then-add so re-runs converge to the right definition)
-- ----------------------------------------------------------------------------
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_customer_id_fkey";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_processed_by_id_fkey";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_processed_by_id_fkey"
  FOREIGN KEY ("processed_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_item_id_fkey";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_promo_code_id_fkey";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_promo_code_id_fkey"
  FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_transaction_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_profile_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_transaction_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sent_sms" DROP CONSTRAINT IF EXISTS "sent_sms_profile_id_fkey";
ALTER TABLE "sent_sms" ADD CONSTRAINT "sent_sms_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sent_sms" DROP CONSTRAINT IF EXISTS "sent_sms_sent_by_id_fkey";
ALTER TABLE "sent_sms" ADD CONSTRAINT "sent_sms_sent_by_id_fkey"
  FOREIGN KEY ("sent_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sent_sms" DROP CONSTRAINT IF EXISTS "sent_sms_transaction_id_fkey";
ALTER TABLE "sent_sms" ADD CONSTRAINT "sent_sms_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sent_sms" DROP CONSTRAINT IF EXISTS "sent_sms_template_id_fkey";
ALTER TABLE "sent_sms" ADD CONSTRAINT "sent_sms_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "sms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 4b. Row Level Security — ENABLE with no public policies (deny-by-default)
--      RenTech's frontend never talks to Supabase directly; all access goes
--      through the backend API, which connects as postgres (Prisma) or uses
--      the service-role key (storage/auth admin). Both bypass RLS, so the app
--      is unaffected. Enabling RLS with zero permissive policies blocks all
--      anon/authenticated PostgREST access — this clears the Supabase
--      "creates tables without RLS" warning safely. Do NOT add permissive
--      policies unless you introduce direct browser-to-Supabase queries.
-- ----------------------------------------------------------------------------
ALTER TABLE "profiles"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_codes"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sent_sms"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_templates"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_rules"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"       ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 5. Private storage bucket for item photos (service-role only; app signs URLs)
--    If this INSERT errors on your Supabase version, create it in
--    Dashboard -> Storage -> New bucket: name `rentech-images`, Private.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rentech-images', 'rentech-images', false, 20971520,
        ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 6. Required seeds — business rules + SMS templates (matches prisma/seed.ts)
--    The app reads these on every booking/fee/SMS path; without them it falls
--    back to hardcoded defaults, so seed them.
-- ----------------------------------------------------------------------------
INSERT INTO "business_rules" ("key", "value", "description") VALUES
  ('late_penalty_per_day',   '500', 'Late return penalty per day in PHP'),
  ('damage_fee',             '1000', 'Damage fee in PHP'),
  ('rental_period_days',     '3',   'Default rental period in days'),
  ('min_downpayment',        '200', 'Minimum downpayment in PHP'),
  ('overdue_escalation_days','3',   'Days a rental must stay overdue before the escalation SMS fires'),
  ('data_retention_months',  '12',  'Months of notifications/SMS/audit history to keep before the scheduled purge deletes it')
ON CONFLICT ("key") DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;

INSERT INTO "sms_templates" ("id", "name", "content", "is_default") VALUES
  ('booking_confirmation', 'booking_confirmation',
   'Hi {customer}, your booking for {item} is confirmed! Pickup date: {date}. Rental period: 3 days. Thank you for choosing Mylene''s Boutique!',
   true),
  ('due_reminder', 'due_reminder',
   'Hi {customer}, this is a reminder that your rental of {item} is due on {date}. Please return on time. Thank you!',
   true),
  ('late_return', 'late_return',
   'Hi {customer}, your rental of {item} is now overdue ({days} day(s)). Please return as soon as possible. Thank you!',
   true)
ON CONFLICT ("id") DO UPDATE SET
  name = EXCLUDED.name,
  content = EXCLUDED.content,
  is_default = EXCLUDED.is_default;

-- ----------------------------------------------------------------------------
-- 7. OPTIONAL demo catalog (commented out — uncomment to load it)
--    Mirrors backend/prisma/seed.ts items. Statuses use the CURRENT enum
--    (the old seed's 'Maintenance' is now 'OutOfService').
-- ----------------------------------------------------------------------------
-- INSERT INTO "inventory_items" ("id", "name", "category", "price", "status", "image") VALUES
--   (1001, 'A-Line Ivory Lace Wedding Gown', 'Gown', 7500, 'Rented', 'https://www.ivoryandwhitebridal.com/wp-content/uploads/2025/08/Veronica-14.webp'),
--   (1002, 'Emerald Silk Mermaid Evening Gown', 'Gown', 4500, 'Available', 'https://www.misshow.com/cdn/shop/files/Elegant-Stunning-Off-the-Shoulder-Mermaid-Prom-Evening-Dresses-Ruffles-With-Split.jpg?v=1763109918'),
--   (1003, 'Midnight Black Peak Lapel Tuxedo', 'Suit', 3800, 'Available', 'https://ainsleyandtroupe.com/cdn/shop/files/C6FAEB1D-7C1E-46FC-BCD1-1477043E1A80_900x.jpg?v=1701724313'),
--   (1004, 'Modern Charcoal Grey Slim Suit', 'Suit', 3200, 'Available', 'https://andreemilio.com/wp-content/uploads/2021/06/243a-Web-2.jpg'),
--   (1005, 'Hand-Embroidered Piña Barong', 'Barong', 3500, 'Rented', 'https://ibarrafilipino.com/cdn/shop/files/Barong_Tagalog_JV402_05.png?v=1769482029&width=1600'),
--   (1006, 'Burgundy Velvet Debutante Ball Gown', 'Gown', 6500, 'Available', 'https://images.unsplash.com/photo-1568252542512-9fe8fe9c87bb?w=800&q=80'),
--   (1007, 'Navy Blue Windowpane Check Suit', 'Suit', 3400, 'OutOfService', 'https://i.etsystatic.com/27528860/r/il/a0dfcf/3998770015/il_570xN.3998770015_q0j2.jpg'),
--   (1008, 'Organza Barong with Geometric Patterns', 'Barong', 2800, 'Available', 'https://barongsrus.com/wp-content/uploads/2023/08/1070A_SMM.jpg'),
--   (1009, 'Champagne Satin Bridesmaid Midi', 'Gown', 2500, 'Available', 'https://www.fancyvestido.com/cdn/shop/files/FV12459_3_1000x.jpg?v=1700880311')
-- ON CONFLICT ("id") DO UPDATE SET
--   name = EXCLUDED.name, category = EXCLUDED.category,
--   price = EXCLUDED.price, status = EXCLUDED.status, image = EXCLUDED.image;
-- SELECT setval(pg_get_serial_sequence('inventory_items','id'), (SELECT MAX(id) FROM inventory_items));

-- ----------------------------------------------------------------------------
-- 8. Verification (run these after the script succeeds)
-- ----------------------------------------------------------------------------
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- Expected: audit_logs, business_rules, inventory_items, notifications, payments,
--           profiles, promo_codes, sent_sms, sms_templates, transactions
--
-- SELECT key, value FROM business_rules ORDER BY key;      -- expect 6 rows
-- SELECT id, name FROM sms_templates ORDER BY name;        -- expect 3 rows
-- SELECT COUNT(*) FROM inventory_items;                    -- 0 unless §7 loaded
-- SELECT * FROM storage.buckets WHERE id = 'rentech-images'; -- 1 private bucket
