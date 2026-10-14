# Plan: Close the NFR Gaps in RenTech

Status legend: fix targets are **1.1** (harden), **1.2** (pooling), **1.5**, **2.4**, **3.1**, **3.2**, **3.4**, **4.1**, **4.5**, and booking-concurrency.
Skipped per decision: **1.3 (SSR)** — documented as client-side-rendered / N/A.

## Order of work (low-risk, high-value first)

### Phase 1 — Backend correctness & reliability (no UI risk)

1. **Atomic booking (fixes double-book race; supports 1.2/3.3)**
   - File: `backend/src/services/transactions.service.ts` (`createRental`, ≈ lines 29–115).
   - Wrap the *item lookup → overlap check → `transaction.create` → item status flip* in `prisma.$transaction(async (tx) => {...}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })`, catching the serializable-conflict error and re-throwing `409`.
   - Keep audit-log + notification + SMS **after** the transaction commits (outside the `$transaction` block).
   - Verify: backend compiles; booking still succeeds; simulate two near-simultaneous creates → one gets `409`.

2. **DB connection pooling (fixes 1.2)**
   - File: `backend/.env` — change Supabase URL from direct port `5432` → session-mode pooler `6543` and append `?pgbouncer=true&connection_limit=1`.
   - Verify: backend restarts, `/api/health` ok, a login + list call succeed.

3. **Search indexes (hardens 1.1)**
   - `backend/prisma/schema.prisma`: add `@@index([name])`, `@@index([category])`, `@@index([status])` (and `@@index([description])`) on `InventoryItem`; `@@index([itemId, status])` on `Transaction`.
   - Additive → `prisma db push` works. Stop backend → `prisma generate` → restart.

4. **Condition-photo history (fixes 3.4)**
   - Schema: add `releasePhoto String? @map("release_photo")` and `returnPhoto String? @map("return_photo")` to `Transaction` (keep legacy `conditionPhoto` as the booking-time/legacy photo).
   - `transactions.service.ts`: `processReturn` writes `returnPhoto` (stop overwriting `conditionPhoto`); `releaseRental` writes `releasePhoto`.
   - Additive → `prisma db push` + regen.
   - Verify: book (photo A) → release (photo B) → return (photo C) → row retains all three.

### Phase 2 — Security & uptime hardening

5. **HTTPS hardening (2.4)**
   - File: `backend/src/index.ts`. Add `app.set('trust proxy', 1)`; extend `helmet()` with `hsts({ maxAge })`; add prod-only middleware that 301-redirects `http`→`https` when `x-forwarded-proto === 'http'`.
   - No card/PAN data ever touches the app (already hosted PayMongo); this just enforces TLS at the edge.

6. **Uptime / process resilience (3.1)**
   - Add `ecosystem.config.cjs` (pm2: `restart: true`, `max_restarts`, `watch: false`) and an npm script `start:pm2`. Note deploy platform health-check at `/api/health` (already exists). Document.

### Phase 3 — SMS (fixes 1.5: within 60s + customer reminders)

7. **Scheduler interval**: `backend/src/index.ts:58` — `5 * 60 * 1000` → `60 * 1000`.
8. **Customer due-today SMS** (currently staff-only in-app): in `sms.service.ts` `notifyDueToday` (≈ lines 139–171), include `customer.phone`, look up the `due_today` template, `applyTemplate`, `sendSms`, write `sentSms`. Add a `dueReminderSent Boolean @default(false)` guard on `Transaction` so the same tx isn't re-texted every minute.
   - Verify: set an item due today (test row) → within ~60s the customer receives an SMS, only once.

### Phase 4 — Accessibility (fixes 4.5)

9. **Create `frontend/src/components/ui/Field.jsx`** — a labeled input that auto-generates `id`, wires `htmlFor`, supports `aria-invalid`/`aria-describedby`.
10. **Sweep key flows** to use it (fixes missing label associations):
    - `Login.jsx` (email/password/customer fields)
    - `CustomerRentalFlow.jsx` (contact/dates/address)
    - `StaffNewRental.jsx` (customer/dates)
    - `ProcessReturnModal.jsx` (notes)
11. **Icon-button labels**: add `aria-label` beside existing `title` on the icon-only buttons in `ItemCard.jsx` (edit/calendar/restore/delete), modal `X` close buttons, `Login.jsx` password-visibility toggle.
12. **Keyboard-operable tiles**: convert the clickable `<div onClick>` item-select tiles in `CustomerRentalFlow.jsx` and `StaffNewRental.jsx` to `<button type="button">` (or add `role="button" tabIndex={0} onKeyDown`).
13. **Dialog semantics**: add `role="dialog" aria-modal="true" aria-labelledby` to the main modals (`ProcessReturnModal`, `TransactionDetailModal`, `ReleaseItemModal`).
14. **Focus visibility**: replace `focus:outline-none` with a visible `focus-visible:ring` on primary inputs/buttons (keep brand accent color).
    - Verify: Tab-navigate Login, booking, and return flows end-to-end; each control announces a label.

### Phase 5 — PWA (fixes 4.1) + Backups (fixes 3.2) + Docs

15. **PWA**
    - `npm i -D vite-plugin-pwa` in `frontend/`.
    - `vite.config.js`: add `VitePWA({ registerType:'autoUpdate', manifest:{ name:'RenTech — Mylene\'s Boutique', short_name:'RenTech', theme_color:'#bf4a53', background_color:'#ffffff', display:'standalone', icons:[...] }, workbox:{ navigateFallback:'/index.html' } })`. (Existing `manualChunks` stays as-is.)
    - `index.html`: add theme-color meta + apple-touch tags. (Plugin injects the manifest link at build.)
    - Generate simple 192×192 and 512×512 icons (maskable) into `frontend/public/icons/` (Squoosh/PowerShell resize, or placeholder from existing logo).
    - Verify: `vite build` succeeds; serve `dist` and confirm the manifest + SW register and the app is installable/offline-cached.
16. **Backups (3.2)** — docs-only (real fix is Supabase-managed): write `docs/BACKUPS.md` + an `AGENTS.md` note: enable Supabase project **Point-in-Time Recovery / scheduled daily backups**, note retention, and the restore runbook. Nothing runs in-code.
17. **Update `AGENTS.md`** Work-State: mark gap items done; note pooler port change, new photo columns, `dueReminderSent` guard, PWA, and the SSR-accepted-as-CSR decision.

### Phase 6 — Verify & build

- Stop backend → `prisma generate` → restart; `tsc` build clean on backend; `vite build` clean on frontend.
- Re-run live timing on `/api/customer/catalog?search=` to confirm still < 3s (now indexed).
- End-to-end smoke: signup/login, book (photo), sale badge price, release, return (second photo), due-today SMS delivers once within 60s, PWA installs.

---

## Explicitly out of scope (decided)

- **1.3 SSR / Next.js migration** — skipped; document CSR + measured < 3 s search as the justification in `AGENTS.md` / thesis notes.
- Real in-app backup scheduler — replaced by Supabase PITR + runbook (3.2).

## Risks / notes

- **Pooler switch**: session-mode pooler breaks Prisma *prepared-statement* defaults unless `pgbouncer=true` is set (will set it).
- **Serializable transactions**: can retry/abort under contention; map aborts to `409` so customers see "unavailable" instead of a 500.
- **Icon assets**: if no clean source logo exists, generate simple branded PNGs rather than block PWA.
- **SMS costs**: more frequent scheduler is negligible; actual message volume is rate-guarded by `dueReminderSent`.
