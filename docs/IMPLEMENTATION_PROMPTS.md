# COMPLETE IMPLEMENTATION PROMPTS
## RenTech — Enhanced with Best Practices

---

## 0. House Rules (prefix these to any agent that doesn't already know the project)

```
- App name: RenTech — Mylene's Boutique (a boutique rental app).
- Store location: Balayan, Batangas, Philippines.
- Backend: Node + Express + Prisma + Supabase (PostgreSQL). Frontend: Vite + React.

CRITICAL RULES:
1. Backend runs from SOURCE via `tsx watch src/index.ts`. Edit `backend/src/**`,
   never `backend/dist/**`.
2. `prisma generate` fails with EPERM (cannot write the engine DLL) WHILE the
   backend is running. For any schema change:
   stop backend → edit `backend/prisma/schema.prisma` → `npx prisma db push`
   → `npx prisma generate` → restart backend.
   `prisma db push` supports ADDITIVE columns only. Do not rename/drop columns.
3. Item images are stored as Supabase private-bucket PATHS (bucket `rentech-images`),
   not URLs. Resolve them ONLY via `storageService.getDownloadUrl(path)` which does
   `createSignedUrl(path, 3600)` → TTL is 3600 s.
   The upload function is named `storageService.uploadFile(fileName, contentType, buffer)`
   (NOT `upload`). See `ItemForm.jsx:95` for the working pattern.
4. Auth token refresh: frontend now stores a refresh token and refreshes on 401 —
   do not re-implement or remove it.
5. Do not add code comments unless the task requires it.
6. Match existing code style (no forced formatter).
7. Verify every change: backend `npm run build -- --noEmit` (tsc) and frontend
   `npx vite build` must both pass. Fix any errors before finishing.
8. Do NOT commit to git unless explicitly asked.

WORKFLOW RULES:
9. Before writing code: Inspect all referenced files first. Reuse existing helpers,
   services, and validation where possible. Do not duplicate existing logic.
10. Match existing architecture and naming conventions.
11. Keep changes as small as possible. Do not refactor unrelated code.
12. Do not rename existing APIs unless required.
13. Do not change unrelated behavior. Existing tests and existing workflows
    should continue working.
14. Do not introduce new abstractions if an equivalent helper already exists.
15. If another task already introduced an appropriate helper, reuse it rather than
    creating a duplicate implementation.

COMPLETION REPORT (always include):
- files modified
- schema changes (if any)
- endpoints changed (if any)
- breaking changes (if any)
- verification performed
- rollback steps (if schema changes)
```

---

## TASK 1 · Atomic booking (prevent double-booking) 🟡

**Prompt:**
```
In backend/src/services/transactions.service.ts, make createRental() atomic.

Problem: today it does (a) availability check, (b) create booking, (c) flip item status,
in THREE separate sequential prisma queries. Two customers booking the same item for
the same date at the same instant can both pass the check before either insert commits
→ double-booking.

Implementation:
1. Read the whole createRental() first.
2. Wrap (a)+(b)+(c) in one interactive transaction:
     prisma.$transaction(async (tx) => {
       // re-check overlap with tx.transaction.findFirst (same WHERE as today)
       // tx.transaction.create(...)
       // tx.inventoryItem.update(...)  // status Reserved vs Active by `isFuture`
     }, { isolationLevel: 'Serializable' })
3. If the overlap finds a conflict (or a serialization/unique error e.g. P2xxx),
   throw AppError(409, 'Item is unavailable for the selected dates') so the API
   returns 409.
4. Move ALL post-commit side effects — confirmation SMS, notifications,
   createAuditLog — to AFTER the transaction resolves (currently they're already
   fire-and-forget try/catch after the create; keep them AFTER the transaction,
   never inside).

Manual steps after editing:
1. Stop backend if running.
2. No schema changes (transaction logic only).
3. Restart backend.

Verify: `tsc` passes. Two concurrent reservations for the same item/date: exactly one
succeeds with 200, the other returns HTTP 409. Normal single booking still works.

Completion report:
- files modified: [list]
- schema changes: none
- endpoints changed: none
- breaking changes: none
- verification performed: [describe]
- rollback steps: git revert [file(s)]
```

---

## TASK 2 · Keep both release + return photos (before/after) ❌

**Prompt:**
```
Problem (two bugs):
1. `backend/src/services/transactions.service.ts` writes BOTH
   `releaseRental()` (~line 373) and `processReturn()` (~line 259) to the same
   `conditionPhoto` column → a return overwrites the release photo.
2. `frontend/src/components/ReleaseItemModal.jsx` (~line 96) and
   `frontend/src/components/ProcessReturnModal.jsx` (~line 154) capture the photo
   only as `URL.createObjectURL(file)` (a `blob:` URL) and submit that string to the
   API. The bytes are never uploaded; the URL dies when the tab closes.

Implementation:
1. Stop backend first.
2. PRISMA: add to the Transaction model:
     releasePhoto String?  @map("release_photo")
     returnPhoto  String?  @map("return_photo")
   Run `npx prisma db push` + `npx prisma generate`.
3. Backend: `releaseRental()` → store in `releasePhoto`; `processReturn()` → store in
   `returnPhoto`. Keep reading legacy `conditionPhoto` for old rows only.
4. Frontend upload (both modals): before submitting, upload the raw bytes:
     const { path } = await storageService.uploadFile(
       `rental/${transaction.id}/{release|return}-${Date.now()}.jpg`,
       'image/jpeg',
       bufferOrBase64
     )
   Send the returned `path` as `releasePhoto` / `returnPhoto`, NOT a blob URL.
   Add one shared `fileToBase64(file)` helper (FileReader → ArrayBuffer) and reuse in
   both. Use `URL.createObjectURL` only for the local preview thumbnail.
5. `TransactionDetailModal.jsx`: display both photos side-by-side after a reload,
   resolving both through the signed URL via ItemImage.
6. Reuse any existing image upload helper if available (check `storageService`).

Manual steps after editing:
1. Stop backend if running.
2. Run `npx prisma db push` (additive columns only).
3. Run `npx prisma generate`.
4. Restart backend.
5. Build frontend.

Verify: release + return; read the row back — releasePhoto AND returnPhoto are
both set and DIFFERENT. Detail view shows two distinct images after F5, URLs are not
`blob:`. tsc + vite build clean.

Completion report:
- files modified: [list]
- schema changes: added `release_photo`, `return_photo` to Transaction
- endpoints changed: none (existing endpoints now store to new fields)
- breaking changes: none (legacy `conditionPhoto` still read)
- verification performed: [describe]
- rollback steps: `npx prisma db push` to remove columns (if safe) or keep them
```

---

## TASK 3 · Fee amounts from BusinessRules, not hand-coded 🟡

**Prompt:**
```
Make late/damage fees configurable via the BusinessRules table, with fallbacks.

Problem: backend/src/utils/fees.ts hardcodes LATE_PENALTY_PER_DAY = 500 and
DAMAGE_FEE = 1000. The BusinessRule table exists and is seeded with keys
`late_fee_per_day`, `damage_fee`, `rental_period_days`, `min_downpayment` (see
backend/prisma/seed.ts), but calculateFees() never reads it → the Settings page has
no effect.

Implementation:
1. Read fees.ts + wherever business rules are fetched (search `getBusinessRules`).
2. Make calculateFees(...) async; load the rules, parseFloat(`late_fee_per_day`)
   and (`damage_fee`), falling back to 500 / 1000 when absent/invalid.
3. Check if a shared `getBusinessRules` function already exists (likely in
   backend/src/services/businessRules.service.ts). If yes, reuse it.
4. Update the one caller, `processReturn()` in transactions.service.ts, to await it.
5. Do NOT create a new service if one already exists.

Manual steps after editing:
1. No schema changes.
2. Restart backend.

Verify: set late_fee_per_day to 600 in DB → process a late return → penalty = daysLate × 600.
tsc passes.

Completion report:
- files modified: [list]
- schema changes: none
- endpoints changed: none
- breaking changes: calculateFees() is now async
- verification performed: [describe]
- rollback steps: revert to sync version (keep async for compatibility)
```

---

## TASK 4 · 1-minute SMS check interval 🟡

**Prompt:**
```
In backend/src/index.ts, the scheduler runs every 5 minutes:
  setInterval(runScheduledChecks, 5 * 60 * 1000)

Implementation:
1. Change it to run every 1 minute (60 * 1000).
2. Attach `.unref?.()` so it doesn't keep the process alive (optional but recommended).
3. Do not change any other scheduler behavior.

Manual steps after editing:
1. No schema changes.
2. Restart backend.

Verify: tsc passes; dev server logs scheduled checks ≈ every 60s.

Completion report:
- files modified: backend/src/index.ts
- schema changes: none
- endpoints changed: none
- breaking changes: none
- verification performed: confirmed interval changed
- rollback steps: revert to 5 * 60 * 1000
```

---

## TASK 5 · Supabase connection pooler (port 6543) 🟡

**Prompt:**
```
Switch the backend to use Supabase's connection pooler.

Context: backend/.env has DATABASE_URL pointing at the DIRECT host/port 5432. Under
concurrency this can exhaust connections. Supabase provides a PgBouncer pooler on
port 6543.

Implementation:
1. backend/.env AND backend/.env.example: base DATABASE_URL port → 6543 and add query
   params `?pgbouncer=true&connection_limit=1`. Keep the password/ref exactly.
   (Do not print secrets in your reply; mask them.)
2. No code changes required.
3. Keep existing .env.example format but use 6543.

Manual steps after editing:
1. Stop backend.
2. Edit .env files.
3. Restart backend.

Verify: restart backend → /api/health ok, login works, no "Too many connections"
under a burst of users. Back out if the host doesn't support 6543.

Completion report:
- files modified: backend/.env, backend/.env.example
- schema changes: none
- endpoints changed: none
- breaking changes: none (connection string format changed)
- verification performed: [describe]
- rollback steps: revert port to 5432 and remove params
```

---

## TASK 6 · Add DB search indexes 🟡

**Prompt:**
```
Stop backend first. In backend/prisma/schema.prisma add:
  model InventoryItem { ... @@index([name, category, status]) }
  model Transaction  { ... @@index([itemId, status]) }

Implementation:
1. Stop backend.
2. Edit schema.prisma to add indexes.
3. Run `npx prisma db push`, `npx prisma generate`.
4. Restart backend.
5. Do not add any other indexes unless they appear in EXPLAIN queries.

Manual steps after editing:
1. Stop backend.
2. Run `npx prisma db push` (indexes only, no data changes).
3. Run `npx prisma generate`.
4. Restart backend.

Verify: catalog/search endpoint still answers < 3 s (grep the route for the search
query first); keep latency under 3 s after the change.

Completion report:
- files modified: backend/prisma/schema.prisma
- schema changes: added @@index declarations
- endpoints changed: none
- breaking changes: none
- verification performed: [describe latency before/after]
- rollback steps: remove @@index lines and run db push again
```

---

## TASK 7 · Force HTTPS in production 🟡

**Prompt:**
```
backend/src/index.ts: helmet() exists; no HSTS, no https redirect, `trust proxy` unset.

Implementation:
1. app.set('trust proxy', 1)
2. helmet({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } })
3. Production-only (NODE_ENV==='production') middleware that 301-redirects
   http→https (skip for /api/health). Dev stays HTTP.
4. Place the redirect middleware BEFORE helmet (so helmet sees HTTPS).
5. Use existing `NODE_ENV` check pattern from the codebase.

Manual steps after editing:
1. No schema changes.
2. Restart backend.

Verify (prod build only): opening http://<host> → 301 to https://. Dev unaffected.

Completion report:
- files modified: backend/src/index.ts
- schema changes: none
- endpoints changed: none (new middleware only)
- breaking changes: prod HTTP requests now redirect
- verification performed: [describe prod test]
- rollback steps: comment out middleware
```

---

## TASK 8 · Crash auto-restart (pm2) 🟡

**Prompt:**
```
Add crash recovery for production so the API restarts if it dies.

Implementation:
1. `npm i -D pm2` in backend.
2. Create backend/ecosystem.config.cjs:
   module.exports = { apps: [{
     name: 'rentech-backend',
     script: 'dist/index.js',
     interpreter: 'node',
     restart_delay: 1000,
     max_restarts: 5,
     env: { NODE_ENV: 'production' },
     watch: false,  // production only
   }] };
3. In documentation (README or docs/) note the host must run `pm2 start
   ecosystem.config.cjs` and auto-start on boot (pm2 startup). Health check hook →
   /api/health (already exists).
4. Add npm script: "pm2:start": "pm2 start ecosystem.config.cjs"
5. Do not change dev workflow.

Manual steps after editing:
1. Run `npm run build`.
2. Run `pm2 start ecosystem.config.cjs`.
3. Test auto-restart by killing the process.

Verify: after `npm run build` (tsc), `pm2 start ecosystem.config.cjs` runs; killing
the process triggers an automatic restart. Dev flow (`npm run dev`) unchanged.

Completion report:
- files modified: backend/ecosystem.config.cjs, backend/package.json, README.md
- schema changes: none
- endpoints changed: none
- breaking changes: none (production deployment change)
- verification performed: [describe kill/restart test]
- rollback steps: `pm2 stop rentech-backend`
```

---

## TASK 9 · Send the customer a “due today” SMS (FR 3.6) 🟡

**Prompt:**
```
Blend of #3 and #4 context. In backend/src/services/sms.service.ts, notifyDueToday()
currently selects customer { id, name } (no phone) and only notifies STAFF.

Implementation:
1. Include customer phone in the findMany select.
2. If phone present → sendSms(phone, <the seeded due_reminder template with
   {customer},{item},{date} placeholders>) — reuse the existing template, don't write
   a new string. Append the current late_fee_per_day so the customer sees the penalty.
3. Record the send in SentSms history (use existing pattern).
4. Ensure exactly-once: add `dueReminderSent Boolean @default(false)` to Transaction
   (stop backend → db push → generate → restart). Filter enabled `NOT dueReminderSent`,
   set it true after a successful send; leave false on failure so the next tick retries.
5. Reuse existing BusinessRules service for late_fee_per_day.
6. Do not create a new SMS template.

Manual steps after editing:
1. Stop backend.
2. Add `dueReminderSent` to Transaction model.
3. Run `npx prisma db push`, `npx prisma generate`.
4. Restart backend.

Verify: due-today rental → scheduler tick sends the customer SMS within ~60s, exactly
once (not every minute). Confirm with tsc.

Completion report:
- files modified: backend/src/services/sms.service.ts, backend/prisma/schema.prisma
- schema changes: added `due_reminder_sent` to Transaction
- endpoints changed: none
- breaking changes: none
- verification performed: [describe SMS test]
- rollback steps: remove `due_reminder_sent` column
```

---

## TASK 10 · Make it a real PWA 🟡

**Prompt:**
```
frontend is mobile-responsive but is not a PWA (no manifest, no SW, no offline cache).

Implementation:
1. `npm i -D vite-plugin-pwa` in frontend.
2. Add VitePWA to frontend/vite.config.js with:
   registerType 'autoUpdate'; manifest name "RenTech — Mylene's Boutique",
   short_name 'RenTech', theme_color #bf4a53, icons 192x192 + 512x512
   (put PNGs in frontend/public, generate or source them).
3. Link `<link rel="manifest">` in index.html.
4. Gotcha: vite.config sets `outDir: 'build'`, but `vite preview` serves
   dist by default → after build, test with
   `npx vite preview --outDir build` and confirm sw.js + manifest load.
5. `npm run build` must emit sw.js + manifest.
6. Use existing Vite config patterns.

Manual steps after editing:
1. Install dependencies.
2. Create icon PNGs in frontend/public (use existing logo or generate).
3. Run `npm run build`.
4. Test with `npx vite preview --outDir build`.

Verify: Chrome DevTools → Application → Manifest/SW ok; app installable; navigate
offline after first load.

Completion report:
- files modified: frontend/vite.config.js, frontend/index.html, frontend/package.json
- schema changes: none
- endpoints changed: none
- breaking changes: none (PWA is additive)
- verification performed: [describe PWA test]
- rollback steps: revert config, remove icons
```

---

## TASK 11 · Accessibility sweep 🟡

**Prompt:**
```
Four small fixes across many files.

Implementation:
a) Create `frontend/src/components/ui/Field.jsx`: a labeled field that auto-generates
   id/name, links `<label htmlFor>`, forwards aria-* attributes. Refactor Login.jsx,
   CustomerRentalFlow.jsx, StaffNewRental.jsx, ProcessReturnModal.jsx to use it.
b) Icon-only buttons → add aria-label:
   - ItemCard action buttons (Edit / Availability / Restore / Delete)
   - All modal close X (ReleaseItemModal, ProcessReturnModal, ChatbotModal,
     TransactionDetailModal, StaffNewRental, CustomerRentalFlow ×3)
   - Photo-remove X in release & return modals
   - Login show/hide-password eye ×2 → aria-label + aria-pressed
   - Chatbot send button; NotificationsDropdown close (use aria-label, not title)
c) Clickable tiles become real `<button type="button">`:
   - CustomerRentalFlow item cards (~L358), StaffNewRental (~L446),
     ItemCard customer card (~L149)
d) Modals get `role="dialog" aria-modal="true" aria-labelledby` + Escape-to-close.
e) Restore visible focus: replace hidden outline with a `focus-visible` ring.
   Use existing CSS pattern or Tailwind's `focus-visible:ring-2`.

Manual steps after editing:
1. Run `npm run build` to check for errors.
2. Test with keyboard-only navigation.

Verify: tab-only through login → booking → return; every control reachable &
announced; Lighthouse a11y score rises meaningfully (target ≥ 90).

Completion report:
- files modified: [list all]
- schema changes: none
- endpoints changed: none
- breaking changes: none (styling/accessibility only)
- verification performed: [describe Lighthouse before/after]
- rollback steps: revert component changes
```

---

## TASK 12 · Image cache (stop flicker / re-fetching) ❌

**Prompt:**
```
Goal: product images resolve once and stay cached so navigation/flicker and refetch
stop, but never serve an expired signed URL.

Context: ItemImage.jsx currently calls storageService.getDownloadUrl(image) in a
useEffect every mount → a grid of 20-40 items fires 20-40 signed-URL requests on
every page, plus flicker. ChatbotModal does the same via its own resolveImage().

Implementation:
1. Create `frontend/src/utils/imageCache.js`:
   - Map<path, { url, expiresAt }>
   - `resolve(path, fetcher)` returns the cached URL if fresh else fetches, stores,
     returns.
   - TTL = 59 * 60 * 1000 (3600s signed-URL TTL − 60s safety).
   - Persisted to sessionStorage (write-through) so an F5 refresh reuses it; never
     localStorage (expired URLs must clear when the tab closes).
2. Rewrite ItemImage.jsx to use imageCache (still show the ImageIcon placeholder while
   resolving). Use `React.memo`-friendly key = path.
3. ChatbotModal's resolveImage() uses the same cache.
4. Reuse existing storageService.getDownloadUrl for the fetcher.

Manual steps after editing:
1. No schema changes.
2. Run `npm run build`.

Verify: hard reload Catalog twice → Network panel shows signed-URL requests only while
loading first, then ZERO on the second pass (and after F5). No flicker.

Completion report:
- files modified: frontend/src/utils/imageCache.js, frontend/src/components/ItemImage.jsx, frontend/src/components/ChatbotModal.jsx
- schema changes: none
- endpoints changed: none
- breaking changes: none
- verification performed: [describe network panel test]
- rollback steps: revert ItemImage to original implementation
```

---

## TASK 13 · Staff can edit customer + booking details (FR 2.3) 🟡 (biggest)

**Prompt:**
```
Goal: staff update customer info and booking dates/notes without cancel+re-book.

Scope:
- Customer edit: PUT /customers/:id (Admin/Staff), fields name, phone, address,
  preferences. Build frontend/src/components/CustomerEditModal.jsx; add an Edit button
  where customer records render; log an audit entry on every edit.
- Booking edit: PATCH /transactions/:id (Admin/Staff); fields ONLY rentalDate, dueDate,
  notes. Re-run the same availability/overlap check as createRental() (extract a shared
  helper you also use in createRental) — if the edit overlaps another booking return 409.
  Wire an "Edit dates" action into TransactionDetailModal.jsx, then refetch.
- Do NOT allow editing item or fee fields (those stay "cancel + rebook").

Implementation:
1. Read controllers + services + audit logging first (there's already an audit
   service / createAuditLog — reuse it).
2. Check if a shared availability check function exists. If not, extract from
   createRental into `backend/src/utils/availability.ts`.
3. Build endpoints + validation (zod) with Admin/Staff role gates.
4. React UI: CustomerEditModal.jsx + buttons + wire into useInventory/useCustomers data.
5. Reuse existing hooks and API calls where possible.

Manual steps after editing:
1. No schema changes (customer and transaction already have required fields).
2. Run `npm run build` for both backend and frontend.

Verify: staff edits customer phone → saved + visible; editing dates into a conflicting
window → 409 with a friendly message; audit log has an entry with who/before/after.

Completion report:
- files modified: [list all]
- schema changes: none
- endpoints changed: PUT /customers/:id, PATCH /transactions/:id
- breaking changes: none (new endpoints)
- verification performed: [describe tests]
- rollback steps: revert endpoints, remove modals
```

---

## TASK 14 (optional) · Real AI suggestions from Gemini 🟡

**Prompt:**
```
The AI "optimization suggestions" panel currently shows HARDCODED template sentences;
Gemini doesn't generate them.

Implementation:
1. Find the underperforming-items query (search "never rented" in the codebase; also
   the trend numbers).
2. Feed that data into the existing Gemini report generator
   (backend/src/services/gemini.service.ts, exposed via POST /api/ai/generate-report,
   admin-only) so promo/restock suggestions are actually AI-generated from that data.
3. Keep the static strings only as a fallback.
4. Reuse existing gemini.service.ts if available.

Manual steps after editing:
1. No schema changes.
2. Restart backend.

Verify: generate a report → suggestions vary with input data (not identical every call).

Completion report:
- files modified: [list]
- schema changes: none
- endpoints changed: none (behavior change only)
- breaking changes: none
- verification performed: [describe AI response test]
- rollback steps: revert to static templates
```

---

## TASK 15 · Document Supabase backups (ops) ❌

**Prompt:**
```
Backups of Postgres data are managed by the platform, not the app.

Implementation:
1. Create `docs/BACKUPS.md`: enable Supabase PITR / scheduled daily backups in the
   dashboard; document retention period, restore steps, and RPO/RTO expectations.
2. Add a note/reference in AGENTS.md (see "Important Details").
3. Do not modify code.

Manual steps after editing:
1. No schema changes.
2. No restart required.

Verify: docs/BACKUPS.md exists with install steps and restore procedure; AGENTS.md
references it.

Completion report:
- files modified: docs/BACKUPS.md, AGENTS.md
- schema changes: none
- endpoints changed: none
- breaking changes: none
- verification performed: documentation review
- rollback steps: remove files
```

---

## Final verification checklist (run after all prompts)
- [ ] Atomic booking — concurrent double-book → one 200 + one 409.
- [ ] Release/return photos both persist + show side-by-side after reload.
- [ ] Fees use Admin-set rules (change rule to 600 → penalty ×600).
- [ ] Customer receives booking SMS instantly + due-today SMS ≈<60s, exactly once.
- [ ] HTTPS force + pm2 auto-restart in prod.
- [ ] PWA installable, images cached (0 refetch), no flicker.
- [ ] A11y: labels linked, dialogs keyboard-dismissable, focus visible.
- [ ] Staff editing works with an audit trail.
- [ ] `tsc` (backend) + `vite build` (frontend) both clean.

---

## Quick Reference: Shared Helpers to Check First

Before implementing any task, check if these already exist:

| Task | Check for Existing Helper |
|------|---------------------------|
| 1 | `checkAvailability()` in transactions.service.ts |
| 2 | `uploadFile()` in storage.service.ts |
| 3 | `getBusinessRules()` in businessRules.service.ts |
| 9 | `sendSms()` in sms.service.ts |
| 12 | `getDownloadUrl()` in storage.service.ts |
| 13 | `createAuditLog()` in audit.service.ts |

*Source: IMPLEMENTATION_ROADMAP.md + DETAILED_IMPLEMENTATION_ROADMAP.md · Compiled 2026-08-03.*