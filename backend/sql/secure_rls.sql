-- ============================================================
-- RenTech: Enable Row Level Security (RLS) on all public tables
-- ------------------------------------------------------------
-- Safe for this app: the backend connects to Postgres as the
-- `postgres` superuser (see backend/.env DATABASE_URL), which
-- BYPASSES RLS. So enabling RLS here only blocks the public
-- Supabase REST API (anon / authenticated roles) — which the
-- app does NOT use. Nothing in the Prisma backend breaks.
-- ============================================================

-- 1) Enable RLS on every user-data table.
--    (No policies -> anon/authenticated REST access is denied by default.)
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_codes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sent_sms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_templates   ENABLE ROW LEVEL SECURITY;

-- NOTE: `_prisma_migrations` is intentionally skipped — it is a
-- Prisma system table (the linter flag is noise). Leave it as-is.

-- 2) Fix the SECURITY DEFINER function warning.
--    `app_user_role()` should not be callable by the public API.
--    Revoke EXECUTE from anon + authenticated (postgres/service keep it).
REVOKE EXECUTE ON FUNCTION public.app_user_role() FROM anon, authenticated;

-- ============================================================
-- OPTIONAL: if you EVER add client-side Supabase queries later,
-- add explicit permissive policies below. The backend is
-- unaffected because it uses the superuser connection.
-- Example (public catalog read for anyone):
--   CREATE POLICY "public read inventory" ON public.inventory_items
--     FOR SELECT USING (true);
-- ============================================================
