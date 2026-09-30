# Improvements Plan — Realtime Hybrid Approach

Date: 2026-09-10
Scope: add Supabase Realtime as a lightweight trigger layer only. Keep existing REST polling + TTL caching for all heavy data.

## Principle

- Keep **REST polling + 60s TTL cache** for KPIs, forecasts, analytics bundle, catalog (`frontend/src/hooks/useDashboard.js`, dashboard bundle, `backend/src/index.ts` scheduler).
- Add **Realtime only as an invalidation signal** for lightweight events: `notifications` inserts, `transactions` status flips (due-today/overdue/no-show), cleaning-queue changes.
- On Realtime event: refetch the already-existing REST endpoint, never push full payloads over the socket. If socket drops, polling covers it (resilient on unstable connections).

## Changes

### 1. Supabase setup (no code)
- Enable Replication (Publication) for `notifications` and `transactions` tables only.
- Add SELECT RLS policies so staff subscribe to staff alerts and customers to own `profileId` rows only.
- Free tier covers boutique scale (200 peak conns, 2M msgs/mo); each open tab = 1 connection.

### 2. Frontend subscribe (small, isolated)
- `frontend/src/components/NotificationsDropdown.jsx`: open one channel `supabase.channel('notifs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, onNew)` → refetch `GET /notifications` + bump badge. Remove channel on unmount.
- Optional same pattern for staff today-view / cleaning queue (`StaffTasksView`, `CleaningQueue`): on `transactions` UPDATE → refetch `/dashboard/today` or invalidate `useDashboard` cache key.
- Guard: only subscribe when `VITE_SUPABASE_URL/ANON_KEY` set; wrap in try/catch; never break REST path if Realtime fails.

### 3. Backend: no logic change
- Keep schedulers and REST shapes as-is (`sms.service.ts:notifyDueToday/autoNotifyOverdue/checkNoShowAndNotify`, `notifications.service.ts`). Realtime reads the rows they already write.
- Do not move KPI/forecast computation into Realtime handlers.

## What NOT to do
- No Realtime for KPIs, forecasts, revenue aggregates, catalog images, or public catalog (SW already handles images via `CacheFirst` on `/object/public/`; `/api/*` stays uncached — `frontend/vite.config.js`).
- No removal of polling/caching fallback.

## Acceptance
- [ ] With Realtime on: new staff alert appears in dropdown in ~1-2s without manual refresh.
- [ ] With Realtime blocked (offline/socket kill): dropdown still correct after next poll; no console crash.
- [ ] `grep channel\( frontend/src` shows only the notif/today subscriptions; no KPI/forecast subscription.
- [ ] Free-tier usage stays << limits (connections ≈ open tabs, messages ≈ notification count).
