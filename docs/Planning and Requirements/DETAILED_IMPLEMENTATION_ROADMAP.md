# DETAILED_IMPLEMENTATION_ROADMAP
## RenTech — Detailed Gap-Fix Roadmap (code-level)

This is the fully expanded, code-level version of `IMPLEMENTATION_ROADMAP.md`. Every gap is verified against the actual source with **file paths, line numbers, current code, the exact fix, effort, and risk**. Use this as the working document; the short roadmap and the audit files (`NFR_GAP_PLAN.md`, `FR_COMPLIANCE.md`) summarize the same work.

**Status legend:** 🟡 = partially done · ❌ = missing/not working
**Audit date:** August 3, 2026

### House rules (read once before touching code)
- **Backend runs from `src` via `tsx watch src/index.ts`** — ALWAYS edit `backend/src/`, never `dist`.
- **`prisma generate` fails (EPERM) while the backend is running** (engine-DLL lock). For any step that touches `schema.prisma` (items **2**, **5**, **6**, **13**, **16**), do: stop backend → edit schema → `prisma db push` → `prisma generate` → restart backend.
- DB is PostgreSQL on Supabase. `prisma db push` works for **additive** columns.
- Store location is **"Balayan, Batangas"** — used in the AI stylist FAQ and chatbot.
- Item images live in the **private** bucket `rentech-images` as paths, NOT URLs. `backend/src/services/storage.service.ts`:
  - `getDownloadUrl(path)` → `createSignedUrl(path, 3600)` — **TTL is 3600s (1 hr)**, line 52. Use this when computing client cache windows.
  - The upload function is named **`uploadFile(fileName, contentType, buffer)`** (line 37), **NOT `upload`**. `ItemForm.jsx:95` is the only current caller. The release/return modals do NOT call it (see gap #2).
  - Allowed MIME: jpg/jpeg/png/webp · size limit 20MB · bucket is private.
- Frontend root: `C:\Users\johnr\RenTech - Capstone`. Frontend app root: `frontend/src`.

---

## Deep dive: what's actually in the code (evidence)

- `createRental()` in `transactions.service.ts` is **three sequential queries** — overlap check (`findFirst`, line 74–85) → `transaction.create` (line 89–110) → `inventoryItem.update` status flip (line 112–115). No `prisma.$transaction` wraps them. (A `$transaction` appears only in `deleteTransaction()` line 334.)
- Condition photo is **one column**: `conditionPhoto` (`condition_photo`). Written in `processReturn()` **line 259** AND `releaseRental()` **line 373** — a return **overwrites** the release photo. There is **no `releasePhoto` / `returnPhoto`** and no `@@index` in `schema.prisma` at all (checked all models).
- Fees: `backend/src/utils/fees.ts` lines 1–2 hardcode `LATE_PENALTY_PER_DAY = 500`, `DAMAGE_FEE = 1000`. The `BusinessRule` table exists (`schema.prisma` model lines 190–198; seeded keys in `backend/prisma/seed.ts`: `late_fee_per_day`, `damage_fee`, `rental_period_days`, `min_downpayment`) but `calculateFees()` **never reads it**. Note: `rentalDate` param in `calculateFees` is unused.
- SMS: `sms.service.ts` `notifyDueToday()` (line 139–171) selects customer `{ id, name }` **only** — no phone — and calls `notifyStaffMembers` only. It **never sends an SMS to the customer**. Compare `autoNotifyOverdue()` (line 56–137), which DOES read `customer.phone` and calls `sendSms`. `sendSms(phone, message)` lives in `semaphore.service.ts` line 6.
- Scheduler: `index.ts` line 58 `setInterval(runScheduledChecks, 5 * 60 * 1000)` — 5 minutes, no `unref()`.
- `trust proxy` not set anywhere; `helmet()` IS used (line 15).
- `.env` DATABASE_URL: `postgresql://…@db.vlidakdroeqpoemzolus.supabase.co:**5432**/postgres` — direct port, **no pooler**, no `?pgbouncer`.
- `/api/health` exists (`routes/index.ts`) but checks nothing (no DB ping).

---

# A. BACKEND FIXES — reliability first (no UI changes)

## 1. Booking is not atomic — can double-book the same outfit 🟡
**Effort: M (1 hour) · Risk: low · Files: `transactions.service.ts`, `schema.prisma` (no), tests**

**Should do:** Two people can never book the same gown for the same date.

**Wrong now:** The check-then-create is two separate `await` statements. The overlap query runs at line 74–85, the `create` at 89–110, item-status update at 112–115 — all outside a transaction. Two customers hitting "Book" in the same instant both pass the check before either insert commits → **double-booking**.

**Fix (do next):**
1. In `createRental()` after the item fetch + validation, wrap in:
    ```ts
    const created = await prisma.$transaction(async (tx) => {
      // 1. Re-run the overlap check INSIDE the transaction with the same WHERE.
      // 2. tx.transaction.create(...)  // the booking insert
      // 3. tx.inventoryItem.update(...) // set status Reserved/Rented — same as L112
      return newlyCreated;
    }, { isolationLevel: 'Serializable' });
    ```
2. Catch a `P2010` / unique-violation / overlap result and throw `AppError(409, 'Item unavailable for the selected dates')`.
3. Keep confirmation SMS/email **after** the whole transaction commits (already after, but move into the `.then`/post-commit path so an SMS failure never rolls back the booking).
4. Add a regression test: fire two overlapping creates concurrently; assert exactly one succeeds and the loser gets 409.

**Verify:** Booking still works; simultaneous requests on the same item/date — one 200, one 409.

## 2. Condition photo is lost: "before" overwritten + never uploaded ❌ (most important data fix)
**Effort: L (3–4 hr) · Risk: high (telemetry) · Files: `schema.prisma`, `transactions.service.ts`, `items.controller`? NO — `frontend ReleaseItemModal.jsx`, `ProcessReturnModal.jsx`, `storage.service.ts` (no change)**

**Should it should do:** Keep a "released" (before) photo AND a "returned" (after) photo for every rental, forever, and compare them later.

**Wrong now (two bugs):**
1. **Overwrite:** Both `releaseRental()` (line 373) and `processReturn()` (line 259) write the same `conditionPhoto` column. Processing a return **wipes the release photo** — no before/after exists.
2. **Never persisted:** Both frontend modals capture the photo as a **blob object URL** only:
   - `ReleaseItemModal.jsx` line 98: `setPhotoUrl(URL.createObjectURL(file))`, then line 17–18 submits `conditionPhoto: photoUrl` — a `blob:` URL — straight to the API. Never uploaded.
   - `ProcessReturnModal.jsx` line 156: `setReturnPhotoUrl(URL.createObjectURL(file))`, passed up in `onComplete(...)` line 20. Never uploaded.
   `blob:` URLs die with the tab → photos are effectively missing.
   (For reference, `ItemForm.jsx` lines 92–100 shows the correct pattern: `storageService.uploadFile(...)` → persist the returned `path`, use the blob only for local preview.)

**Do next:**
1. **Schema** (T - stop backend first):
```prisma
// Transaction model
releasePhoto String? @map("release_photo")   // NEW — the "before" photo path
returnPhoto  String? @map("return_photo")     // NEW — the "after" photo path
conditionPhoto String? @map("condition_photo") // KEEP legacy column untouched for old rows
```
2. **Backend `transactions.service.ts`:**
   - `releaseRental()`: write `releasePhoto` (drop `conditionPhoto` from that update).
   - `processReturn()`: write `returnPhoto` (drop `conditionPhoto` from that update).
   - Keep reading `conditionPhoto` for backward displays (old records).
3. **Frontend upload:** in both modals, before calling `onComplete`/submit:
```js
const { path } = await storageService.uploadFile(
  `rental/${transaction.id}/release-${Date.now()}.jpg`, 'image/jpeg',
  /* base64 string from FileReader, or Buffer from arrayBuffer */
);
submit({ releasePhoto: path });   // path, NOT blob URL
```
Add a `fileToBase64` helper (FileReader → data URL → strip prefix) and reuse across both modals.
4. **Display:** to show before vs after in `TransactionDetailModal.jsx`, resolve both through `ItemImage` (signed URLs).

**Verify:** After release+return, the DB row has BOTH `releasePhoto` and `returnPhoto` values (not the same path), and the detail view shows two distinct images after a page reload (no blob).

---

### 3. Late / damage fees hardcoded — Settings has no effect 🟡
**Effort: S · Risk: low · Files: `utils/fees.ts`, `transactions.service.ts`, `settings/rules service` (seed)**

**Should it should do:** Late = "₱500 per day"; damage = "₱1,000" — editable in Settings and used by the fee calculator.

**Wrong now:** `fees.ts` hardcodes both. The `BusinessRule` table + Settings UI exist, but `calculateFees()` (line 4–23) never queries them. Changing the rule in settings changes nothing.

**Be concrete (no guessing keys):** the only seeded rule keys are `late_fee_per_day`, `damage_fee`, `rental_period_days`, `min_downpayment` (see `backend/prisma/seed.ts`).
**Do next:**
1. Make `calculateFees(rentalDate, dueDate, returnDate, isDamaged)` **async** and have it `await settingsService.getBusinessRules()` → read `late_fee_per_day` + `damage_fee` → `parseFloat`, fallback to `500` / `1000`.
2. Its only caller is `processReturn()` in `transactions.service.ts` line ~225 — add `await`.
3. Fetch rules **once** per `processReturn()` (pass the values in), not per item.
4. Consider deleting the never-used `rentalDate` param (or use it for a "late vs not-late on rental start" distinction later — leave as-is minimum).

**Verify:** change Settings late fee to 600 → return an overdue item → penalty reflects 600, not 500.

---

## 4. SMS reminders up to 5 minutes late 🟡
**Effort: XS · Files: `index.ts` (line 58); `sms.service.ts` (due-flag)**

**Fix:** change line 58 to `setInterval(runScheduledChecks, 60 * 1000)`. Also add `runScheduledChecks().unref?.()` so it doesn't block shutdown (portability). Booking-confirmation SMS stays instant (unchanged).

---

## 5. DB pool: direct port, no connection pooling 🟡
**File: `backend/.env`**
- `DATABASE_URL` currently `…@db-…supabase.co:5432/…` (direct).
- Switch to the **pooler endpoint**: `…:6543/…` and add query params `?pgbouncer=true&connection_limit=1`.
- Do it in BOTH `.env` and `.env.example`. No code change needed.
- **Verify:** restart backend, hit `/api/health` and `/login`; confirm no connection exhaustion after a burst.
> CAUTION: pgbouncer (transaction pooling) largely removes **session** features like `ServerSessionSort`/prepared-statement interpolation. If you use Prisma, just set `pool_timeout` / rely on the pool defaults — Prisma's interactive transactions still work; long-running advisory locks do not (none used).

---

## 6. No search indexes (slow as catalog grows) 🟡
**Files: `schema.prisma`, then `prisma db push` + regenerate (stop backend first)**
- Search is fast now (~2 ms; wildcard `contains`) but unindexed. As inventory grows, unindexed ILIKE scans degrade.
- Add:
```prisma
model InventoryItem { ... @@index([name, category, status]) }  // for search/catalog
model Transaction  { ... @@index([itemId, status])          // for overlap + status queries
```
- (Optional composite for due-date scans: `@@index([status, dueDate])`.)
- Then `npx prisma db push`; `npx prisma generate` (after stopping server, per house rule); restart.

---

# B / C. SMS — customer-facing deadline to-do (FR 3.6)

## 11. Due-today SMS never reaches the customer 🟡
**Files: `sms.service.ts` `notifyDueToday()` (line 139–171), `Transaction` model (add `dueReminderSent`), `.env`**

**Should it:** Text the CUSTOMER (1) a booking confirmation (already works), and (2) a "your rental is due today" reminder.

**Gap:** `notifyDueToday()` selects `customer: { id, name }` (NO phone), calls `notifyStaffMembers` ONLY. Customer never gets the overdue/due SMS — compare `autoNotifyOverdue()` which DOES read `phone` + `sendSms`.

**Do next:**
1. In the `findMany` (`include.customer`), add `phone: true`.
2. In the loop, after `notifyStaffMembers`:
```ts
// if customer.phone, send SMS:
await sendSms(customer.phone, `Your rental "${item.name}" is due today (${dueDate}). Please return at Mylene's Boutique, Balayan, Batangas.`);
```
record in SentSms; guard against doubles:
3. Add `dueTodayReminderSent Boolean @default(false)` to `Transaction` (`db push` + regen), and in the query filter `NOT dueTodayReminderSent; on success set it true, before setting it back in a try/catch so a failed send can retry next cycle.
4. Dedupe: `update` in same `Promise.all` pattern.

**Verify:** Create a rental with `dueDate` = today, run scheduler; customer receives SMS within ~60s, exactly once.

---

## 12. HTTPS not forced 🟡
**File: `index.ts` (`app.use(helmet())` L15 exists)**
- Add `app.set('trust proxy', 1)` (correct `req.ip` behind proxy).
- Enable HSTS in production: `helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } })`.
- Optional HTTP→HTTPS redirect middleware for `NODE_ENV === 'production'`.

**Verify:** `curl -k http://…` on the prod host returns 301 → https. (Actual TLS termination is the host's job.)

## 13. No crash-recovery / auto-restart (99.9% uptime) 🟡
**Files: NEW `ecosystem.config.cjs`; `pm2` in devDeps; docs**
- Write:
```js
module.exports = { apps: [{
  name: 'rentech-backend',
  script: 'src/index.ts',
  interpreter: 'tsx',
  restart_delay: 1000, max_restarts: 5,
} ] };
```
- Note: the deployed host must auto-start pm2 (systemd/pm2 startup). Health monitor already exists (`/api/health`).

---

## 14. Connection-pool flag note (extra) — combine with #5 if you like. (Skip.)

---

# C. FRONTEND — user experience

## 15. Not a real PWA 🟡
**Effort: medium (build only) · Files: `package.json`, `vite.config.js`, new icons, `index.html`**
- Install `vite-plugin-pwa`; add to `vite.config.js`:
```js
VitePWA({ registerType: 'autoUpdate',
  manifest: { name: 'RenTech — Mylene's Boutique', short_name: 'RenTech',
  theme_color: '#bf4a53', icons: [{src:'/pwa-192.png',sizes:'192x192'},{src:'/pwa-512.png',sizes:'512x512'}] } })
```
- Generate 192×192 + 512×512 PNG icons into `frontend/public/` , add `<link rel="manifest">`.
- `npm run build` must produce `sw.js` + manifest. Verify installability off-line (Chrome DevTools → Application → Manifest/Service Worker).

## 16. Accessibility partial — field-label links, aria-labels, dialog roles, keyboard cards 🟡
**Effort: large-ish sweep but each change is trivial · Files: many → see list below; + NEW `components/ui/Field.jsx`**

### a. Create reusable field (`frontend/src/components/ui/Field.jsx`) — fields help
- Takes `id`, `label`, `children` — or simpler auto-generates `id` from `name`, puts `htmlFor` on the label, and wires `id` into the input; forwards `aria-*`.
- Use in: `Login.jsx` (email, password, signup fields), `CustomerRentalFlow.jsx` (contact + sizes + measurements + promo), `StaffNewRental.jsx` (customer contact + measurements), `ProcessReturnModal.jsx` (notes).

### b. Icon-only buttons get `aria-label`
- `ItemCard.jsx` L47–62: currently use `title=` → add `aria-label="Edit item"` / `View availability` / `Restore item` / `Delete item`.
- Modal close buttons: `ChatbotModal` L200, `ReleaseItemModal` L44, `ProcessReturnModal` L36, `TransactionDetailModal` L78, `StaffNewRental` L377, CustomerRentalFlow L331/428/741.
- Photo remove X: `ReleaseItemModal` L90, `ProcessReturnModal` L144.
- Login show-password eye `Login.jsx` L241 & L363: `aria-label={showPassword ? 'Hide password' : 'Show password'}`.
- Chatbot send button L304.
- Also `NotificationsDropdown` close (title→aria-label).

### c. Cards = real buttons
- `CustomerRentalFlow.jsx` L358–385: change the clickable `<div onClick…>` to `<button type="button" …>` (keep same classes) — focusable + Enter/Space natively.
- `StaffNewRental.jsx` L446–470: same change.
- `ItemCard.jsx` L149–151 (customer card div → wrap in `<button>` or add `role="button" tabIndex=0 onKeyDown`).

### d. Modal semantics
- Add to every bare modal wrapper: `role="dialog" aria-modal="true" aria-labelledby=<titleId>`, give the header an `id`. Add `onKeyDown` Escape-to-close where advantageous.
- Backdrops already close on click-outside.

### e. Focus ring
- Tailwind default disables outlines globally; add `.focus-visible` ring when controls are reached via keyboard (or set a global `:focus-visible` rule). Visible focus everywhere.

**Check:** tab through Login → booking → return on keyboard only; every input reachable, label announced, buttons speak their action.

---

## 17. Images refetch (flicker) every navigation ❌
**Files: `components/ItemImage.jsx`, `components/ChatbotModal.jsx`→ move, NEW `utils/imageCache.js`**

**Why:** `ItemImage.jsx` (L11–22) on every mount calls `storageService.getDownloadUrl(image)` (a fresh `GET /storage/{path}`, TTL 3600s). Grids of 20–40 items = 20–40 requests per page render and flicker on every navigation. `ChatbotModal` resolves at the data level (L23–31) with the same un-cached call.

**Do next:**
1. `utils/imageCache.js`:
```js
class ImageCache {
  constructor() { this.map = new Map(); }
  get(path) { growth: if (entry.expiresAt > Date.now()) return entry.url; }
  set(path, url, ttlMs) { this.map.set(path, { url, expiresAt: Date.now() + ttlMs }); }
  async resolve(path, fetcher) {
    const cached = this.get(path); if (cached) return cached;
    const { url } = await fetcher(path); this.set(path, url, CACHE_TTL); return url; }
}
```
- `CACHE_TTL = 59 * 60 * 1000` (3600s − 60s buffer) so we never serve an expired signed URL.
- **Two layers:** in-memory Map (navigation flicker gone) + `sessionStorage` write-through on set with same TTL (survive a page refresh; auto-clears when tab closes — correct for short-lived signed URLs). **Do NOT use `localStorage`** (would leak stale URLs).
- Then `ItemImage.jsx` calls `imageCache.resolve(image, getDownloadUrl)` and sets state only when the resolved value changes; keep the same placeholder fallback.

3. `ChatbotModal.jsx` `resolveImage` uses the same `imageCache.resolve`.

**Verify:** Load Catalog → back → Catalog: the signed-URL request count in DevTools is **0** for previously-loaded paths. After `F5` refresh it is also ~zero (served from sessionStorage, no flicker).

---

# D. FRONTEND — new features (FR 2.3)

## 18. Staff can't edit customer info or booking details 🟡
**Goal:** Staff edit a customer (name / phone / address / preferences) and correct booking **dates** + **notes** without canceling. Item/fee changes stay "cancel + re-book" (out of scope — impacts payments/audits/promos).

**Evidence:** `StaffRecordsView.jsx` (in `components/`) has NO edit button — only "View All" (read-only recent list) and two dead chevron buttons. `TransactionDetailModal.jsx` is a pure read-only view (no edit affordance).

**Build (recommended scope):**
1. **Customer edit:**
   - `PUT /customers/:id` (Admin/Staff) — new controller `customers.controller.ts` + validation (name, email, phone, address, preferences)
   - NEW `components/CustomerEditModal.jsx` — pre-fill, validate, save, toast.
   - Add "Edit" button on customer rows in the records view.
2. **Booking edit:**
   - `PATCH /transactions/:id` (Admin/Staff) with fields `rentalDate`, `dueDate`, `notes`. **Re-run the same overlap check** as `createRental()` — don't allow editing into a conflict.
   - In `TransactionDetailModal.jsx`, add an "Edit dates/notes" action → same modal pattern, closes → refetch.
3. **Audit logging:** log all customer/transaction edits (who + before/after). (Existing audit service — wire it in.)
**Verify:** staff A edits a customer's phone → record updates; two staff can't book a conflicting date after edit; audit trail shows the changeer.

## 19 (optional) AI suggestions from Gemini, not templates 🟡
- Currently "AI suggestions" are **hardcoded template strings** in the UI; Gemini doesn't generate them.
- Fix: `frontend` passes the underperforming-items + trend data into the existing `gemini.service.ts` report generator so promo/restock suggestions are actually AI-produced. Static strings can remain as fallback.

---

# E. OPS & DOCUMENTATION

## 20. No automated DB backups ❌
- Own the platform, not the app. **Document**, don't build:
  - Enable Supabase **Point-in-Time Recovery / scheduled PostgreSQL daily backups** in the dashboard.
  - Create `docs/BACKUPS.md`: retention, restore steps, RPO/RTO notes.
  - Note in `AGENTS.md`.

---

# F. OUT OF SCOPE (decided)
- **SSR (NFR 1.3):** client-side SPA rebuild to Next.js is large. Skipping; justify with measured <3 s search latency + small data volume.
- **Editing booking fees/items in place:** stays "cancel + re-book" (see #18).

---

# Suggested execution order (safest first)
| # | Task | Where | Requires |
|---|------|-------|---------|
| 1 | Condition-photo columns + real upload (#2) | schema + backend + frontend | stop backend for schema |
| 2 | Atomic booking ($transaction) (#1) | backend | — |
| 3 | DB pooler (#5) + search indexes (#6) | `.env` + schema | stop backend for `db push` |
| 4 | Fees from rules (#3) + 60s scheduler (#4) | backend | — |
| 5 | Customer due-SMS (#11) + flag | `sms.service.ts` + schema | schema change |
| 6 | HTTPS + pm2 (#12/#13) | `index.ts` + new config | — |
| 7 | Accessibility sweep (#16) | frontend | — |
| 8 | Image cache (#17) | frontend | — |
| 9 | PWA (#15) | frontend build | — |
| 10 | Staff edit (#18) | backend+frontend | schema |
| 11 | Backups docs (#20) + AI (#19) + AGENTS update | docs | — |

**Schema steps** (1, 2, 3, 6, 11): remember **stop backend → `prisma db push` → `prisma generate` → restart**.

---

# Final verification checklist
- [ ] Book + release + return work, and both photos persist (releasePhoto + returnPhoto) and display.
- [ ] Two simultaneous bookings on same item/date → one 409.
- [ ] `GET /api/…/catalog?search=…` still < 3 s after adding indexes.
- [ ] Customer gets booking SMS instantly + due-today SMS within ~60s (only once).
- [ ] Staff can edit customer info + booking dates/notes; fees/item edits remain "cancel + re-book".
- [ ] App installable (PWA) + Photos render without refetch.
- [ ] Keyboard-only navigation works through Login, booking, return.
- [ ] `npm run build` (frontend) + `tsc` (backend) both clean.

---

*Source files: IMPLEMENTATION_ROADMAP.md, NFR_GAP_PLAN.md, FR_COMPLIANCE.md · Anchors: see house-rules + "Deep dive" sections.*