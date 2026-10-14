# IMPLEMENTATION_ROADMAP

## RenTech — Gap-Fix Roadmap

This document lists every requirement that is **NOT fully done** and explains, in simple terms:
1. **What it should do** — the requirement in plain words
2. **What's wrong now** — the actual gap we found
3. **What we'll do** — the concrete fix

Requirements are ordered **safest-first** (backend data fixes → security → SMS → accessibility → features → PWA/docs).

**Status legend:** 🟡 = partially done · ❌ = missing/not working
**Source:** Audits saved in `NFR_GAP_PLAN.md` and `FR_COMPLIANCE.md`.

---

## A. BACKEND FIXES — reliability first (no UI changes)

### 1. Booking is not atomic (can double-book the same outfit) 🟡
- **Should do:** Two people can never book the same gown for the same date.
- **Wrong now:** The system *checks* if the item is free, **then** *saves* the booking as two separate steps. If two customers click "Book" at the same moment, both checks can pass before either saves → **double-booked**.
- **Do next:**
  - `backend/src/services/transactions.service.ts` → `createRental()`
  - Wrap the **overlap check + create booking + set item status** inside one `prisma.$transaction(..., { isolationLevel: 'Serializable' })`.
  - If it fails, return `409 "Item unavailable"`.
  - Keep confirmation SMS/email **after** the transaction finishes.

### 2. Return photo erases the "before" photo; photos are never saved properly ❌ (most important data fix)
- **Should do:** Keep a "released" photo AND a "returned" photo for every rental, forever.
- **Wrong now (two problems):**
  1. Both photos write to the **same `condition_photo` database field** → processing a return **overwrites the release photo**. No before/after comparison possible.
  2. The photo is kept only as a **temporary browser blob** (`URL.createObjectURL`) and is **never uploaded to storage** — it disappears when you close the tab.
- **Do next:**
  - Add two new fields to the `Transaction` table: `releasePhoto` and `returnPhoto` (keep old `conditionPhoto` for old data).
  - `releaseRental()` → save to `releasePhoto`.
  - `processReturn()` → save to `returnPhoto`.
  - **Actually upload** the photo: `ReleaseItemModal.jsx` and `ProcessReturnModal.jsx` must call `storageService.upload(...)` and save the returned path (not a blob URL).

### 3. Late / damage fees are hardcoded — changing settings has no effect 🟡
- **Should do:** Fees like "₱500 per day late" and "₱1,000 for damage" come from business rules you can change in the Settings page.
- **Wrong now:** The numbers are written directly into the code (`backend/src/utils/fees.ts`: ₱500, ₱1000). A rules table exists in the database but **the calculator ignores it**. Changing settings does nothing.
- **Do next:** Make `calculateFees()` read the fee amounts from the `BusinessRule`/settings store first; only fall back to constants if nothing is set.
  - **Be concrete (do not guess keys):** the only seeded rule keys are `late_fee_per_day`, `damage_fee`, `rental_period_days`, `min_downpayment` (see `backend/prisma/seed.ts`). Read `late_fee_per_day` + `damage_fee` via `settingsService.getBusinessRules()` → `parseFloat(...)` → fall back to `500` / `1000`. `calculateFees()` becomes `async`; its caller is `processReturn()` in `transactions.service.ts`. Fetch the rules once per call (not per-item).

### 4. SMS reminders may be up to 5 minutes late 🟡
- **Should do:** SMS should be sent within 60 seconds of the event.
- **Wrong now:** Booking-confirmation SMS is sent right away (good). But overdue/due-again checks run on a timer every **5 minutes**.
- **Do next:** `backend/src/index.ts:58` → change the timer from `5 * 60 * 1000` to `60 * 1000` (every 1 minute).

### 5. No database connection pooling (could fail under many simultaneous users) 🟡
- **Should do:** Handle owner + staff + many customers at once.
- **Wrong now:** The app uses Supabase's **direct port (5432)**. Under heavy use, it can run out of connections.
- **Do next:** `backend/.env` → switch to Supabase **pooler port (6543)** and add `?pgbouncer=true&connection_limit=1` to `DATABASE_URL`. Restart and confirm health + login still work.

### 6. No search indexes (will get slow as the catalog grows) 🟡
- **Should do:** Search stays fast (<3s) even with hundreds of items (future NFR 1.1).
- **Wrong now:** Search is fast **today** (~2ms) but uses a wildcard text match with **no database indexes**. It will slow down as inventory grows.
- **Do next:** `backend/prisma/schema.prisma` → add `@@index` on `InventoryItem` (`name`, `description`, `category`, `status`) and `Transaction` (`itemId`, `status`), then `prisma db push` and regenerate the client.

---

## B. BACKEND — security & uptime

### 7. The app doesn't force HTTPS 🟡
- **Should do:** All connections are encrypted.
- **Wrong now:** Card data is safe because **PayMongo handles it on their hosted page**. But our app itself doesn't force HTTPS; it just sets basic security headers and relies on the deployment host.
- **Do next:** `backend/src/index.ts` → add `app.set('trust proxy', 1)`, enable HSTS via `helmet`, and add a production-only rule that redirects `http` → `https`.

### 8. No crash-recovery / auto-restart for 99.9% uptime 🟡
- **Should do:** The digital catalog stays up 99.9% of the time.
- **Wrong now:** We have a health-check endpoint and error handling. But there's no process manager (if the app crashes, it stays down), no monitor, no hosting config.
- **Do next:** Add a `pm2` config (`ecosystem.config.cjs`) for auto-restart, and point the host's health check at `/api/health` (already exists). *(The actual 99.9% uptime depends on your host.)* **pm2 is for production/staging only** — do not change the dev flow (`npm run dev` + `tsx watch` stays as-is).

---

## C. SMS — the customer-facing deadline fix (FR 3.6)

### 9. Return-deadline SMS is staff-only (customer never gets it) 🟡 (real gap)
- **Should do:** Text the customer: **(1)** when booking is confirmed, **(2)** to remind them their return is due today.
- **Wrong now:** Booking confirmation **works**. But the "due today" reminder only creates an **in-app alert for staff** — it never texts the customer.
- **Why:** `backend/src/services/sms.service.ts` → `notifyDueToday()` only calls `notifyStaffMembers(...)` and never selects or uses the customer's phone number.
- **Do next:** In `notifyDueToday()`, also get `customer.phone` → `sendSms(customer.phone, ...)` and record it in the SMS history. Add a `dueReminderSent` flag on the Transaction so it doesn't re-text every minute.
  - **Reuse the existing template**, do not write a new string: the `due_reminder` SMS template is already seeded (placeholders `{customer}`, `{item}`, `{date}`) — substitute those, and include the late-fee amount from #3 (`late_fee_per_day`) so the customer knows the penalty.

---

## D. FRONTEND — user experience

### 10. Not a real PWA (Progressive Web App) ❌
- **Should do:** Installable, works offline, feels like a native app.
- **Wrong now:** The app **is mobile-responsive** (works on phones/tablets) — but it's **not a PWA**: no manifest, no service worker, no offline cache.
- **Do next:** Install `vite-plugin-pwa`; add a manifest (app name `"RenTech — Mylene's Boutique"`, theme color `#bf4a53`, icons), auto service worker, offline caching. Generate `192×192` and `512×512` icons. Verify `npm run build` produces an installable app.
  - **Gotcha:** `frontend/vite.config.js` sets `build.outDir: 'build'`, but `vite preview` serves `dist/` by default. After adding the plugin, confirm `npm run build` then `npx vite preview --outDir build` actually serves the manifest + service worker.

### 11. Accessibility is partial 🟡
- **Should do:** Usable by people with different technical skills and by keyboards/screen readers.
- **Wrong now:** Images have alt text and forms use the right input types (good). But several basics are missing:
  - Form **labels aren't linked** to their inputs (`<label>` has no matching `id`/`htmlFor`).
  - **Icon-only buttons** (edit, delete, close X) have no `aria-label`.
  - Selectable item **cards are `<div>` elements you can't use with a keyboard**.
  - Modals lack `role="dialog"`; visible focus outlines are turned off (`focus:outline-none`).
- **Do next (4 small fixes):**
  1. Create a reusable input component `frontend/src/components/ui/Field.jsx` that auto-generates `id`, links `label`/`htmlFor`, and supports `aria-*` attributes.
  2. Use it in: `Login.jsx`, `CustomerRentalFlow.jsx`, `StaffNewRental.jsx`, `ProcessReturnModal.jsx`.
  3. Add `aria-label` to all icon-only buttons (`ItemCard` actions, modal close, Login's show-password).
  4. Turn clickable item **tiles into real `<button type="button">`** in `CustomerRentalFlow.jsx` and `StaffNewRental.jsx`. Add `role="dialog" aria-modal="true" aria-labelledby` to modals, and restore a visible focus ring.
- **Check:** Tab through the app using only the keyboard — everything must be reachable and announced.

### 12. Images reload/flicker every time you switch pages ❌ (new — the one you noticed)
- **Should do:** Photos load once and stay cached.
- **What's wrong:** Every time a product photo renders, `ItemImage.jsx` re-fetches a **new signed URL** from the server. Grids of 20–40 items cause 20–40 requests + visible flicker; this repeats every time you go back to Catalog or Home.
- **Do next:**
  - Create a small shared cache `frontend/src/utils/imageCache.js` (`Map<path, {url, expiresAt}>`).
  - `ItemImage.jsx` and `ChatbotModal.jsx` call `imageCache.resolve(path)` instead of calling `getDownloadUrl()` directly.
  - Cache for `min(backendSignedUrlTTL, 50 min) − 60s` so we never serve an expired link.
  - Two layers: **in-memory `Map`** (stops flicker during navigation) + **`sessionStorage` write-through** (survives a page refresh; auto-clears when tab closes — correct for short-lived signed URLs). Do **not** use `localStorage`.

---

## E. FRONTEND — new feature: staff can edit things (FR 2.3)

### 13. Staff can't edit customer info or booking details 🟡 (biggest remaining task)
- **Should do:** Staff should be able to **update** customer information and **correct booking details** without canceling.
- **What's wrong:** Recording a new customer works (walk-ins auto-sign-up). But there is **no way to edit an existing customer** or **change a booking's dates/notes** — staff must cancel and re-book.
- **What we'll build (recommended scope):**
  - **Customer edit:** a simple modal on the records view → edit name / phone / address / preferences → saved via a new `PUT /customers/:id` (Admin/Staff only) with audit logging.
  - **Booking edit:** edit **dates and notes only** from `TransactionDetailModal` → new `PATCH /transactions/:id` (Admin/Staff only). **It re-runs the same availability overlap check** so you can't accidentally edit into a conflict.
  - **Out of scope (for now):** changing the item or the fee — that impacts payments, audits, and promos. Those stay "cancel + re-book."
- **Do next:** Build `CustomerEditModal.jsx` + wire endpoints; add "Edit" buttons on customer records and transaction details; confirm audit-log entries.

### 14. AI optimization suggestions are static (not AI-generated) 🟡 (optional / low priority)
- **Should do:** AI suggests which items to promote or restock.
- **What's wrong:** The system correctly **finds underperforming items** (`never rented`). But the "suggestions" shown are **hardcoded template sentences** in the UI — Gemini doesn't actually generate them.
- **Do next:** Pass the underperforming + trend data into the existing Gemini report prompt so promo/restock recommendations are **AI-generated**. *(Optional; static ones still convey the info.)* Gemini report generation lives in `backend/src/services/gemini.service.ts` and is exposed via `POST /api/ai/generate-report` (Admin-only, `ai.routes.ts`) — feed the underperformers into that prompt.

---

## F. OPS & DOCUMENTATION

### 15. No automated daily database backups ❌
- **Should do:** Automatic daily backups of PostgreSQL data.
- **What's wrong:** Nothing in the code or server does backups.
- **Do next:** Backups belong to the platform, not the app. **Document** using Supabase's managed **Point-in-Time Recovery / scheduled daily backups** (enable in the Supabase dashboard, note retention period and restore steps). Create `docs/BACKUPS.md` + note it in `AGENTS.md`.

---

## G. OUT OF SCOPE (decided)

- **NFR 1.3 — Server-side rendering (SSR):** The app is a client-side Single Page App (Vite + React). A true SSR migration (Next.js) is a large rebuild. **Decision: skip.** We will justify it in the write-up with evidence that search is fast (<3s measured) and that client-rendering is acceptable for this data volume.
- **Changing booking fees/items in edit** (see #13) — stay as "cancel + re-book."

---

## Execution order (safest first)

| # | Task | Risk | Effort |
|---|------|------|--------|
| 1 | #2 Condition-photo columns + **real upload** | Low | Med |
| 2 | #1 Atomic booking (`$transaction`) | Low | Med |
| 3 | #5 DB pooler + #6 search indexes | Low | Low |
| 4 | #3 Fees from rules + #4 1-min SMS scheduler | Low | Low |
| 5 | #9 Customer return-SMS | Low | Med |
| 6 | #7 HTTPS + #8 pm2 config | Low | Low |
| 7 | #11 Accessibility sweep | Med | Med |
| 8 | #12 Image cache (in-memory + sessionStorage) | Low | Low-Med |
| 9 | #10 PWA | Med | Med |
| 10 | #13 Staff edit (customer + booking-dates) | Med | **High** |
| 11 | #15 Backups docs / #14 AI suggestions / update `AGENTS.md` | Low | Low |

> **Windows reminder:** `prisma generate` fails while the backend runs (engine-DLL lock). For steps that touch the schema (1, 2, 3, 6, 9), always **stop the backend**, regenerate, then restart.

---

## Final verification checklist
- [ ] Can still book + release + return, and both release/return photos persist on the transaction; the before (release) + after (return) photos are shown side-by-side on `TransactionDetailModal`.
- [ ] Two simultaneous booking attempts on the same item/dates: one gets `409`.
- [ ] Search `/api/customer/catalog?search=xxx` still < 3 seconds.
- [ ] Customer receives booking SMS at once + due-today SMS within ~60s (and only once).
- [ ] Staff can edit customer info + booking dates/notes; fee/item changes still need cancel+rebook.
- [ ] App is installable (PWA) and reloads photos instantly without refetching.
- [ ] Tab-only keyboard navigation works through Login, booking, and return flows.
- [ ] Backend (`tsc`) + frontend (`vite build`) both build clean.
