# Backend → Frontend Integration Audit — RenTech

**Date:** 2026-07-13
**Scope:** Full codebase — all 16 backend route modules vs ~40 frontend components (`frontend/src`).
**Methodology:** Each backend route (`backend/src/routes/*`) was cross-referenced against every `api.get/post/put/delete/download` call in `frontend/src` (components + `utils/`). Response shapes were read from controllers/services and compared to the properties the UI actually reads.

**Headline findings:** 1 fully-dead payments module (payment is *faked* in the UI), a validated-but-never-applied promo discount (customers charged full price), a customer booking status mismatch, and systemic silent error handling (`.catch(()=>{})` / bare `console.error`) across the app.

---

## 1. Orphaned Backend Features
Backend logic with **no frontend consumer** (dead relative to the UI):

- **Payments module (entirely unwired):** `POST /api/payments/create-intent` and `GET /api/payments/:id` have zero frontend references. Because no transaction ever gets a `paymentIntentId`, the PayMongo webhook (`webhooks.controller.ts:79`) has nothing to attach to → the whole payments data path is dead. *(payments.controller.ts)*
- **`GET /api/dashboard/today`** — never called. `getTodayTasks` (dueToday/overdue/inCleaning) is dead; `DashboardView` re-derives these client-side. *(dashboard.service.ts:137)*
- **`GET /api/transactions/upcoming`** — never called; `StaffTasksView` re-derives client-side. *(transactions.controller.ts:163)*
- **`GET /api/transactions/:id`** — never called. `TransactionDetailModal` only renders the in-memory list object, so `payments[]`, `processedBy`, full `item`, `customer.phone` are never shown.
- **`GET /inventory/:id`** and **`DELETE /inventory/:id`** — never called. Delete is faked via `PUT ... {status:'Deleted'}`; the Admin hard-delete route (with its business rule) is dead. *(inventory.controller.ts:59,98)*
- **`POST /storage/upload-url`** and **`GET /storage/:path`** — zero frontend calls. Images are instead sent as base64 `data:` URLs in `POST /inventory`, bypassing the 5 MB bucket + signed-URL flow. *(storage.controller.ts:13,23)*
- **Catalog/Bookings parallel API:** `GET /catalog`, `GET /catalog/:id`, `GET /bookings`, `GET /bookings/:id` — all orphaned; frontend loads via `/inventory` + `/transactions` instead. Server-side category/search filtering is dead. *(customer.routes.ts:11-17)*
- **`GET /api/notifications/unread-count`** — never called; badge is instead derived from `notifications.length` after the dropdown opens. *(notifications.routes.ts:11)*
- **`GET /api/sms/history`** — never called; sent-SMS log has no UI. *(sms.routes.ts:13)*
- **`GET /api/promo-codes/:id`** — never called (manager only lists all).

---

## 2. Broken Connections
Mismatches in routes, methods, payloads, or schema semantics:

- **Payment is simulated, not connected.** `CustomerRentalFlow.jsx:216-229` fakes payment with `setTimeout(..., 2000)` and never calls the backend. `paymentMethod` ('gcash'/'card') is collected but never sent. *(CustomerRentalFlow.jsx)*
- **Validated promo discount never applied.** `CustomerRentalFlow.jsx:184` validates and shows `-₱{discountAmount}`, but `handleCustomerBooking` (`App.jsx:327`) posts only `{itemId, rentalDate, dueDate, rentalFee, downpayment, notes}` and `createBookingSchema` has no `promoCode` field. **Net effect: customer sees a discount, is charged full price, nothing recorded.** *(customer.controller.ts:8-17)*
- **`size` / `measurements` / `paymentMethod` / `eventDate` dropped from booking.** `buildTransaction` builds them; booking schema rejects them → never persisted, so `TransactionDetailModal` renders empty. *(CustomerRentalFlow.jsx:157-177)*
- **Customer booking status mismatch.** Backend `createRental` sets item `Rented` + tx `Active` (`transactions.service.ts:94-97`); UI optimistically sets `'Reserved'` (`CustomerRentalFlow.jsx:169`, `App.jsx:339`). After reload the item flips to `Rented` and contradicts the UI.
- **`processReturn` response ignored.** Backend returns `{ ...updated, fees }` (`transactions.service.ts:248`); `App.jsx:278-284` throws `fees` away and `ProcessReturnModal.jsx:10-12` hardcodes ₱500/₱1000 instead of using backend-computed `calculateFees(...)`. UI can misrepresent the charge.
- **`effectiveStatus` ignored.** Controllers return both `status` and computed `effectiveStatus` (`inventory.service.ts:49`); UI only reads `status`, so an item persisted `Rented`/`Reserved` with no active tx displays wrongly (server recomputes to `Available`).
- **`/dashboard/insights` period inconsistency.** `AIInsightsView.jsx:56` fetches period-filtered insights, but `:57` separately fetches `/dashboard/insights` (no period) and uses its `revenueByMonth` → revenue line shows all-time while category metrics are filtered. *(AIInsightsView.jsx:56-57,82)*
- **`/settings/rules` key coupling.** Backend returns arbitrary `Record<key,value>`; frontend hardcodes `business_name`, `business_address`, etc. (`ProfileSettingsView.jsx:67-78`). If seeded keys differ, fields silently keep `localStorage` defaults.
- **Security:** `GET /inventory/:id`, `/inventory/availability`, `/inventory/blocked-dates/:id` have **no `authMiddleware`** (unlike `GET /inventory/`), exposing item detail + availability publicly. *(inventory.routes.ts:11-17)*

---

## 3. Missing UI Feedback
Areas where the frontend ignores backend errors or loading states (fails silently):

- **Inventory/transactions load** — `App.jsx:190-199` swallow errors (`.catch(()=>set…Loading(false))`). A 401/500 looks like "no items" / "no history" with no banner or retry.
- **Add/Update/Status/Restore/Delete inventory** — `App.jsx:368-411` only `console.error`; submit buttons never disabled in-flight. `AddInventoryItemModal.jsx:19-33` closes the modal *before* the request resolves, so a later throw never surfaces.
- **Return/Delete/Cancel transaction** — `App.jsx:290,301,312` only `console.error`; modal just closes on failure.
- **Promo toggle** — `PromoCodesManager.jsx:46-49` `.catch(()=>{})`: optimistic toggle never reverts on failure. List load `:13` swallows silently.
- **Notifications** — `NotificationsDropdown.jsx:26,51,56` all `.catch(()=>{})`; mark-read/clear-all optimistically update even when the server call fails → UI reports success on failure. Read notifications **reappear as "new"** because `GET /notifications` returns read+unread with no filter. *(notifications.service.ts:4-10)*
- **Settings** — `ProfileSettingsView.jsx:64,85,136,202,213,224` swallow errors; `saveTemplate`/`resetTemplate` **report "saved!" even when the request failed** (`:202-228`).
- **Export buttons** — `AIInsightsView.jsx:204-215`, `HistoryView.jsx:163` call `api.download` with no `try/catch`; a 403 (non Admin/Staff) throws unhandled.
- **Dashboard/AI insights** — `AIInsightsView.jsx:54-58` `.catch(()=>null)` on every KPI/forecast/insights call → 500/401 renders zeroed charts with no error UI or retry.
- **SMS send** — `StaffTasksView.jsx:133-147` `catch` only `console.error` and the `finally` **always closes the modal**; no success/failure toast. Preview text is hardcoded and doesn't match the actual sent message (`:565`).
- **AI report** — `AIInsightsView.jsx:520` `.catch(()=>setAiReport(null))` silently drops failures.

---

## 4. Actionable Fixes
Exact snippets to bridge the gaps (highest-impact first).

### FIX A — Wire real payments (currently 100% faked)
`CustomerRentalFlow.jsx:216-229` (also requires creating the booking *before* payment):
```jsx
if (step === 2) {
  if (!validateStep1()) return;
  setIsProcessingPayment(true);
  try {
    const intent = await api.post('/payments/create-intent', {
      transactionId: confirmedTx.id,        // real tx id (create booking first)
      amount: downpaymentAmount,            // PHP number
    });
    await window.Paymongo?.attach(intent.clientKey); // your PayMongo Drop-in
    setPaymentSuccess(true); setStep(3);
  } catch (err) {
    setConfirmError(err?.message || 'Payment failed. Please try again.');
  } finally {
    setIsProcessingPayment(false);
  }
}
```

### FIX B — Apply + persist the validated promo discount
Extend `customer.controller.ts:8-17`:
```ts
export const createBookingSchema = z.object({
  body: z.object({
    itemId: z.number().int().positive(),
    rentalDate: z.string(),
    dueDate: z.string(),
    rentalFee: z.number().positive(),
    downpayment: z.number().min(0).optional(),
    notes: z.string().optional(),
    promoCode: z.string().optional(),
    size: z.string().optional(),
    measurements: z.record(z.any()).optional(),
  }),
});
```
`CustomerRentalFlow.jsx` (summary + booking include):
```jsx
const finalFee = promoApplied ? promoApplied.finalFee : selectedItem.price;
// ...render ₱{Number(finalFee).toLocaleString()}...
const buildTransaction = () => ({ /* … */ rentalFee: finalFee,
  promoCode: promoApplied?.code || null, size: selectedSize, measurements });
```
`App.jsx:327` forward them: `await api.post('/bookings', { ...bookingData, promoCode: bookingData.promoCode, size: bookingData.size, measurements: bookingData.measurements });`
Backend (`promoCodes.service.ts` `validateAndApply`): call `incrementUses(promo.id)` so `currentUses` actually increments.

### FIX C — Fix customer booking status mismatch
`CustomerRentalFlow.jsx:169` → `status: 'Active'`; `App.jsx:339` → `status: 'Rented'` (must match `transactions.service.ts:94-97`). Prefer reading `item.effectiveStatus ?? item.status` everywhere.

### FIX D — Surface silent errors (template to apply widely)
Replace `.catch(()=>{})` / bare `console.error` with user-visible feedback. Example for `App.jsx:290`:
```jsx
} catch (err) {
  alert(err?.message || 'Failed to process return');
} finally {
  setReturnTransaction(null);
}
```
And for `PromoCodesManager.jsx:46`:
```jsx
const prev = code.isActive;
setCodes(c => c.map(x => x.id===code.id ? {...x, isActive:!prev} : x));
try { await api.put(`/promo-codes/${code.id}`, { isActive: !prev }); }
catch (err) { setCodes(c => c.map(x => x.id===code.id ? {...x, isActive:prev} : x)); setMsg(err.message); }
```

### FIX E — Notifications: use unread-count + stop mislabeling
```jsx
// badge (mount/interval):
api.get('/notifications/unread-count').then(d => setUnread(d.count)).catch(()=>{});
const unread = notifications.filter(n => !n.isRead);
// mark-read should only update local state on success:
const handleRemoveOne = async (id) => {
  try { await api.put(`/notifications/${id}/read`);
    setNotifications(p => p.filter(n => n.id !== id)); }
  catch { /* toast, keep item */ }
};
```
Recommend backend `GET /notifications?unread=true` so the returned shape matches the "new" semantics the UI assumes.

### FIX E2 — Settings: don't report success on failure
`ProfileSettingsView.jsx:192-228`: wrap `saveTemplate`/`resetTemplate` in `try/catch`, only mutate local state after a resolved `await api.post/put/delete`, and set `setTemplateSaveMsg('Failed: '+e.message)` on error.

### FIX F — Image upload via Storage (un-wire base64)
`AddInventoryItemModal.jsx`:
```jsx
const { uploadUrl, path } = await api.post('/storage/upload-url',
  { fileName: `${Date.now()}-${file.name}`, contentType: file.type });
await fetch(uploadUrl, { method:'PUT', headers:{ 'Content-Type': file.type }, body: file });
setImageDataUrl(`/storage/${path}`);
```

### FIX G — Wire orphaned read endpoints (optional, reduces client drift)
- `StaffTasksView`: use `GET /transactions/upcoming` instead of re-deriving.
- `DashboardView`/`AIInsightsView`: consume `/dashboard/today` for due/overdue/in-cleaning instead of client recompute; fix the `/dashboard/insights` double-fetch (FIX G2 below).
- `TransactionDetailModal`: call `GET /transactions/:id` to show `payments[]`/`processedBy`/`customer.phone`.
- `StaffTasksView`: add an "SMS Log" panel calling `GET /sms/history`.
- `CatalogView`/`CustomerRentalFlow`: optionally switch to `GET /catalog?category=&search=` for server-side filtering.

### FIX G2 — Dashboard period consistency
`AIInsightsView.jsx:53-65` — remove the second `/dashboard/insights` call and reuse the period-filtered `revenueByMonth`:
```jsx
useEffect(() => {
  setLoading(true); setError(null);
  const p = timeRange === 'Overall' ? '' : `period=${timeRange.toLowerCase()}`;
  Promise.all([
    api.get(`/dashboard/kpis?${p}`),
    api.get('/dashboard/forecast?period=3'),
    api.get(`/dashboard/insights?${p}`),
  ]).then(([k,r,i]) => { setKpis(k); setForecast(r); setInsightsData(i);
    setRevenueChartData(i.revenueByMonth || []); })
   .catch(e => setError(e?.message || 'Failed to load dashboard'))
   .finally(() => setLoading(false));
}, [timeRange]);
```

### FIX H — Security hardening
Add `authMiddleware` to `GET /inventory/:id`, `/inventory/availability`, `/inventory/blocked-dates/:id` in `inventory.routes.ts` if item detail/availability should be authenticated.

---

## Priority order
1. **FIX A** (payments entirely fake) — revenue never collected.
2. **FIX B** (promo discount not applied) — customers overcharged, nothing recorded.
3. **FIX C** (status mismatch) — data contradicts itself on reload.
4. **FIX D/E/E2** (silent errors) — pervasive; add a global error toast and replace all `.catch(()=>{})`.
5. **FIX F/G** (orphaned endpoints, storage, schema) — dead code / drift.
