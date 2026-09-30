-- ============================================================================
-- Storage Row-Level Security for the `rentech-images` bucket
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL Editor. It only affects NON-service-role
-- (i.e. browser/anon) access to Storage. The backend writes using the
-- service-role key, which BYPASSES RLS, so the existing server-side upload
-- flow is unchanged.
--
-- NOTE: app roles (Admin/Staff/Customer) live in `public.profiles`, not in the
-- Supabase JWT `role` claim (which is just 'authenticated'/'anon'). We resolve
-- the real role with a SECURITY DEFINER helper to avoid recursive RLS.
-- ============================================================================

-- 1) Resolve the current user's app role from the profiles table.
create or replace function public.app_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid()::text;
$$;

-- 2) Enable RLS on the bucket in the SUPABASE DASHBOARD (Storage -> rentech-images
--    -> Policies -> enable RLS). The SQL Editor role cannot ALTER storage.objects,
--    so do NOT run "alter table storage.objects enable row level security" here.
--    The policies below only take effect once RLS is enabled in the dashboard.

-- 3) Any signed-in user may READ item photos (bucket is private; they still
--    need a signed URL minted by the backend, but this guards direct access).
drop policy if exists "Item images readable by authenticated users" on storage.objects;
create policy "Item images readable by authenticated users"
  on storage.objects for select
  using ( bucket_id = 'rentech-images' and auth.role() = 'authenticated' );

-- 3b) PUBLIC CATALOG SLICE (Sept 2026 optimization): anonymous (signed-out)
--    browsers may read catalog photos directly via public object URLs — no
--    backend signing round-trip, and the stable URLs are browser/service-
--    worker cacheable. Covers everything EXCEPT `rental/%` condition shots
--    (release/return evidence), which stay signed-URL-only. Thumbnails under
--    `thumbs/` inherit the same rule via the NOT LIKE guard.
--    Applied to the live bucket below; repeat per bucket if STORAGE_BUCKET
--    ever changes. Verify: anon GET on a seed/ object -> 200, on a
--    rental/ object -> 403.
drop policy if exists "Catalog images publicly readable" on storage.objects;
create policy "Catalog images publicly readable"
  on storage.objects for select
  to anon
  using ( bucket_id = 'rentech-items' and name not like 'rental/%' );

-- 4) Only Staff / Admin may UPLOAD (INSERT) item photos.
drop policy if exists "Staff/Admin can upload item images" on storage.objects;
create policy "Staff/Admin can upload item images"
  on storage.objects for insert
  with check (
    bucket_id = 'rentech-images'
    and public.app_user_role() in ('Admin', 'Staff')
  );

-- 5) Only Staff / Admin may UPDATE item photos.
drop policy if exists "Staff/Admin can update item images" on storage.objects;
create policy "Staff/Admin can update item images"
  on storage.objects for update
  using ( bucket_id = 'rentech-images' and public.app_user_role() in ('Admin', 'Staff') )
  with check ( bucket_id = 'rentech-images' and public.app_user_role() in ('Admin', 'Staff') );

-- 6) Only Staff / Admin may DELETE item photos.
drop policy if exists "Staff/Admin can delete item images" on storage.objects;
create policy "Staff/Admin can delete item images"
  on storage.objects for delete
  using ( bucket_id = 'rentech-images' and public.app_user_role() in ('Admin', 'Staff') );
