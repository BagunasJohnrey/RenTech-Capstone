## Objective
- Build out RenTech (Mylene's Boutique rental app): complete the customer rental flow (payment simulation), staff/customer notifications, themed notification dropdown, AI stylist with guard rails + real product images, personalize the customer Home (signup collects phone/address + item-type preferences, editable in Profile Settings), and implement **per-item sales** (admin marks items on sale with optional % off or fixed sale price + optional end date; customers see sale badge/price in Catalog, Collections, and Home; booking charges the sale price).

## Important Details
- **Backend runs from `src` via `tsx watch src/index.ts`** (auto-reloads) — NOT `dist`. All backend edits go to `backend/src/`.
- **Development environment**: Run both frontend and backend concurrently with `npm run dev` in the root directory. This will automatically restart the backend when files change.
- DB is PostgreSQL (Supabase). `prisma db push` works for additive columns. `prisma generate` fails with EPERM if backend is running (holds engine DLL) — must stop backend first, then regenerate, then restart.
- **Store location is "Balayan, Batangas"** (not Metro Manila) — used in `gemini.service.ts` FAQ + `ChatbotModal.jsx`.
- Item images are stored as **Supabase private-bucket paths** in `item.image`. They are NOT absolute URLs, so they must be resolved to signed URLs via `storageService.getDownloadUrl(path)`. **A reusable `components/ItemImage.jsx` now does this** (handles absolute/empty as passthrough/placeholder) and is used everywhere `item.image` is rendered.
- Customer Home + Staff Dashboard both render via **`pages/DashboardView.jsx`** (role-branched), mounted in `App.jsx` for `activeTab === 'Dashboard' || 'Home'`. Customer Home currently shows: Hero, Recommended-for-You (from `customerInfo.preferences`), Your Rentals. "Your Saved Details" and "Browse by Category" were removed per request.
- `ChatbotModal` resolves images at the data level (already had `isAbsoluteUrl` guard + `getDownloadUrl`); left as-is.
- Profile model has `preferences String? @map("preferences")` storing comma-joined item types.
- **Per-item sales (admin-only)**: `InventoryItem` has `onSale Boolean @default(false)`, `discountPct Float?`, `salePrice Float?`, `saleEndsAt DateTime?`. Effective sale price = `salePrice` if set else `price * (1 - discountPct/100)`; a sale is "active" only while `onSale` AND (`saleEndsAt` is null or in the future). Frontend helper `getSaleInfo(item)` in `ItemCard.jsx` centralizes this. **Only Admin may set sale fields**: backend `inventory.controller.ts` `assertSaleAdminOnly` 403s non-admins attempting `onSale`/`discountPct`/`salePrice`/`saleEndsAt`; Staff `allowedFields` excludes sale fields; frontend hides the sale UI (`ItemForm` `showSale={role==='Admin'}`) and strips sale fields from non-admin updates (`App.handleUpdateItem`).
- **Auth token refresh**: frontend previously stored only `access_token` (no refresh), so after ~1h Supabase returned 401 "Invalid or expired token". Fixed: backend `auth.service.ts` `loginUser`/`signupCustomer` now return the full session incl. `refresh_token`; new `frontend/src/utils/authSession.js` stores it and `refreshSession()` silently refreshes on 401; `frontend/src/utils/api.js` retries once with the new token; `useAuth.jsx` uses `setSession`. User must re-login once to get a refresh token.
- **Inventory validation hardened**: `inventory.controller.ts` sale/price number fields use `z.coerce.number()` / `numOrNull` (accept numeric strings from any build) and `saleEndsAt` uses an `isoDateOrNull` preprocess (date-only strings no longer 500). `image` accepts any string/null (Supabase paths, not just URLs).
- Frontend root: `C:\Users\johnr\RenTech - Capstone\frontend\src`.
- **Backups**: Postgres is Supabase-managed. See `docs/BACKUPS.md` for PITR/daily-backup setup, restore steps, and RPO/RTO. Note the pooler-6543 URL in `backend/.env` is for app reads; `pg_dump`/ddl use the direct `:5432` connection.
- **Unified item lifecycle (A–F implemented)**: `ItemStatus` is now `Available/Rented/Reserved/Cleaning/OutOfService/Deleted` (Damaged+Maintenance merged into **OutOfService**, with `InventoryItem.outOfServiceReason` — pushed, existing rows remapped, client regenerated). Returns: intact → `Cleaning`; damaged (`isDamaged` + `Transaction.damageReason`) → `OutOfService` directly, skipping cleaning. **No automatic Cleaning→Available flip** — the boutique cleans in batches, so `CleaningQueue.jsx` has bulk-select + "Mark Selected as Cleaned" via `PATCH /api/inventory/bulk-status` (`bulkSetStatus`, manual states only, audited). Staff can't hand-flip derived states: `ItemCard` shows contextual actions only (Mark Cleaned / Out of Service → reason modal / Restore); Rented/Reserved stay transaction-derived. No-show: `checkNoShowAndNotify()` in `sms.service.ts` (1-day window, `Transaction.noShowNotified` once-guard) → staff `no_show` notification ("Cancel the booking?"); runs in the 1-min scheduler in `index.ts`. For DDL (`prisma db push`/`db execute`) use the direct `:5432` URL built from the `.env` pooler line (same host); stop the backend before `prisma generate` (EPERM on the engine DLL).

## Work State
### Completed
- **Payment simulation**: `paymongo.service.ts` returns mock succeeded intent (`simulated: true`) when `PAYMONGO_SECRET_KEY` unset; `payments.controller.ts` passes `simulated` through; `CustomerRentalFlow.jsx` skips `openDropIn` and completes booking on simulated.
- **React child error fixed**: `CustomerRentalFlow.jsx` renders `confirmedTx.customer?.name` / `confirmedTx.item?.name`.
- **Staff notifications fully built**: `notifyStaffMembers` (deduped); `new_booking` in `createRental`; `late_return` in `processReturn`; `overdue` + `notifyDueToday` in `sms.service.ts`; `index.ts` 5-min scheduler.
- **Notification dropdown redesigned** (`NotificationsDropdown.jsx`).
- **Recent Activity filter responsive**: `StaffTasksView.jsx` + `StaffRecordsView.jsx`.
- **AI stylist hardened**: rate-limit middleware `aiRateLimit.ts`, guard rails, expanded FAQ (Balayan), strict prompt, `isOutfitQuery` gate, no-match store-visit message.
- **Preferences feature**: `preferences` column + backend persist; `Login.jsx` collects phone/address + interest chips; `useAuth.jsx`/`services/auth.js`/`useCustomerProfile.js` carry/persist; `ProfileSettingsView.jsx` editable.
- **Customer Home personalized** (`DashboardView.jsx`): hero uses `customerInfo.name`; "Recommended for You" from preferences; "Your Rentals" summary; `App.jsx` passes `customerInfo`. Booking form (`CustomerRentalFlow.jsx`) prefills saved contact/address.
- **App-wide signed-URL image resolution**: created `components/ItemImage.jsx`; applied to `ItemCard.jsx`, `CleaningQueue.jsx`, `AvailabilityCalendar.jsx`, `GlobalSearchModal.jsx`, `CustomerRentalFlow.jsx`, `StaffNewRental.jsx`. Removed now-unused `ImageIcon`/`Package` imports and `ITEM_TYPES` const/`User` import in `DashboardView.jsx`.
- **Customer Home cleanup**: removed "Your Saved Details" card and "Browse by Category" section (per request). Frontend `vite build` passes.
- **Admin dashboard + caching**: admin gets a standalone role-branched dashboard (staff visual language) fed by `/dashboard/kpis` via `useKpis` (60s TTL cache keyed by role, client fallbacks). `AIInsightsView` has its own 60s TTL cache keyed by time range (Overall/Yearly/Monthly) covering kpis+forecast+insights+inventory-analytics; cached views skip the skeleton and refresh in the background. The embedded `InventoryAnalyticsView` accepts `initialData` so it no longer re-fetches `/inventory/analytics` (parent fetches once and passes it via `cloneElement`).
- **Full security hardening applied (all audit findings C1–L10)**: server-authoritative pricing (`rentalFee` never accepted from clients; fee derived sale-aware in `transactions.service.createRental`; customers must put down ≥50% via `requireMinimumDownpayment`; `POST /api/transactions` is staff/admin-only — customers use `/api/bookings`); payments bounded to `[50% fee, outstanding balance]` with production lock-out when `PAYMONGO_SECRET_KEY` unset; promo codes validate read-only (`checkPromo`) + consume at booking with per-customer cap; login/signup/SMS rate limiters + IP-derived keys with periodic store eviction (`rateLimiter.ts`); webhook idempotency via `Payment.paymongoPiId @unique` (pushed); PII redacted from public `blocked-dates`/availability; upload hardening (`assertSafeUploadPath`, MIME allowlist, `upsert:false`); helmet CSP + build-time CSP meta in frontend (`vite.config.js` `cspPlugin`); CSV formula-injection guard; uniform 401 login; AI history schema caps (role enum, max 10); pagination/forecast clamps; no upstream error-body leakage; walk-in rentals use synthetic profiles (no auth accounts, removed the old 404 fallback that created login-able accounts); `PUT /settings/rules` admin-only; `sma()` is standard null-padded. Backend `tsc` + all 134 vitest tests pass (was 22 failing at HEAD — fixtures updated for server-derived pricing, future dates, `transactions` include, `$transaction`/`aggregate`/`deleteMany` mocks). Lint is broken repo-wide (ESLint v10 flat-config missing) — pre-existing.
- **Known trade-offs**: login returns 401 "Invalid email or password" for both unknown email + wrong password (no account enumeration, sign-up CTA prompt removed); `email_confirm: true` kept (no SMTP — unconfirmed signups would lock users out); tokens still in localStorage (CSP reduces exfil; full httpOnly-cookie migration not done).

### Active
- **Per-item sales feature (mostly done)**: schema pushed + Prisma client regenerated; backend controller enforces admin-only sale fields + forwards them in service; `useInventory` forwards sale fields conditionally; `ItemForm` shows sale UI for Admin only (`showSale={role==='Admin'}`); `ItemCard` shows sale badge + strikethrough via `getSaleInfo`; `CatalogView` has "On Sale" filter; `DashboardView` customer Home has "On Sale" collection; `CustomerRentalFlow` charges/display the sale price. Remaining: visual run-through to confirm.
- **Security batch just landed (uncommitted)**: all audit findings C1–L10 implemented + tests green (134/134) — see Completed section. Remaining optional: commit; rotate the Google Gemini API key that previously lived in `frontend/.env` (repo-untracked, but it was exposed in a past local `.env`); confirm the simulated-payment booking flow in the browser (customers now need ≥50% downpayment).

### Blocked
- (none)

## Next Move
- Run the app and visually confirm the lifecycle flow: intact return → Cleaning; damaged return (with reason) → Out of Service; bulk-select in Cleaning Queue → "Mark Selected as Cleaned" → Available; "Mark Out of Service"/Restore on ItemCard; staff dashboard cleaning banner; no-show notification after 1 day past pickup.
- Also confirm per-item sales UI end-to-end (admin sets sale, customer sees badge/price, booking charges sale price) and item photos across Catalog, Cleaning Queue, Search, Booking, and Home.

## Relevant Files
- **Sales feature**:
  - `backend/prisma/schema.prisma`: `InventoryItem` has `onSale`/`discountPct`/`salePrice`/`saleEndsAt` (pushed + generated).
  - `backend/src/controllers/inventory.controller.ts`: sale fields in create/update Zod schemas; `assertSaleAdminOnly` (admin-only 403 guard) on create + update; Staff `allowedFields` excludes sale fields.
  - `backend/src/services/inventory.service.ts`: create/update types map sale fields.
  - `frontend/src/hooks/useInventory.js`: `addItem`/`updateItem` forward sale fields only when present.
  - `frontend/src/components/ItemForm.jsx`: `showSale` toggle + discount % + sale price + end date inputs.
  - `frontend/src/components/ItemCard.jsx`: exports `getSaleInfo(item)`; renders sale badge + strikethrough price (both staff + customer variants).
  - `frontend/src/pages/CatalogView.jsx`: "On Sale" filter chip + active-filter chip.
  - `frontend/src/pages/DashboardView.jsx`: customer Home "On Sale" collection.
  - `frontend/src/components/CustomerRentalFlow.jsx`: uses `effectiveItemPrice`/`saleInfo` for downpayment, `finalFee`, promo base, and price display.
  - `frontend/src/App.jsx`: `ItemForm showSale={role==='Admin'}` for add/edit; `handleUpdateItem` strips sale fields for non-admins.
- `frontend/src/components/ItemImage.jsx`: **new** reusable signed-URL image component.
- `frontend/src/components/ItemCard.jsx`, `CleaningQueue.jsx`, `AvailabilityCalendar.jsx`, `GlobalSearchModal.jsx`, `CustomerRentalFlow.jsx`: now use `ItemImage`.
- `frontend/src/pages/StaffNewRental.jsx`: image thumbnail uses `ItemImage`.
- `frontend/src/pages/DashboardView.jsx`: customer Home (Recommendations + Your Rentals; Saved Details & Browse-by-Category removed); staff + admin dashboards (role-branched; admin standalone with useKpis).
- `frontend/src/hooks/useDashboard.js`: `useTodayTasks` + `useKpis` (both 60s TTL caches); `AIInsightsView.jsx` + `InventoryAnalyticsView.jsx`: 60s TTL AI cache + `initialData` dedupe (no double analytics fetch).
- `backend/src/services/gemini.service.ts`, `middleware/aiRateLimit.ts`, `services/notifications.service.ts`, `transactions.service.ts`, `sms.service.ts`, `index.ts`: AI + notifications.
- `backend/src/services/paymongo.service.ts`, `controllers/payments.controller.ts`: simulated payment.
- `backend/src/services/auth.service.ts`, `controllers/auth.controller.ts`, `prisma/schema.prisma`: preferences persistence.
- `frontend/src/components/Login.jsx`, `hooks/useAuth.jsx`, `services/auth.js`, `hooks/useCustomerProfile.js`, `pages/ProfileSettingsView.jsx`: preferences UI/flow.
- `frontend/src/App.jsx`: passes `customerInfo` to DashboardView; `ChatbotModal` gets `inventory` + `onBook`.
- `frontend/src/components/ChatbotModal.jsx`: image resolution + outfit-query gating + no-match message.
- `frontend/src/components/NotificationsDropdown.jsx`: themed redesign.
