# Functional Requirements Compliance — RenTech

Audit of the PRD functional requirements against the codebase. Legend: **✅ Achieved** · **🟡 Partial** · **❌ Not found**.

---

## 1. Boutique Owner (Admin)

| FR | Requirement | Verdict | Evidence & Notes |
|----|-------------|---------|------------------|
| 1.1 | Create staff accounts + configure RBAC | ✅ | Staff create/list/delete endpoints are Admin-only (`auth.routes.ts:24-26`, `createStaffAccount` re-checks admin role). Owner UI: **Settings → Staff Management** (`ProfileSettingsView.jsx:577-648`). *Note:* roles are a fixed enum (Admin/Staff/Customer) — no custom/granular permission editor. |
| 1.2 | Secure login to admin dashboard | ✅ | Email/password + Supabase token verify (`auth.service.ts`); role-branched to Admin dashboard (`DashboardView.jsx:301+`). |
| 1.3 | AI business reports via Gemini with natural-language revenue + inventory interpretation | ✅ | `gemini.service.ts:118-196` feeds `monthlyRevenue` + inventory-movement KPIs into the prompt → Gemini narrative; rendered in `AIInsightsView.jsx` + `AIReportModal.jsx`. Gated by `GEMINI_API_KEY`. |
| 1.4 | Seasonal Demand Forecasting via Simple Moving Averages (SMA) | ✅ | Real SMA: `utils/sma.ts`, `dashboard.service.ts:175-201`. Forecast chart + SMA cards in `AIInsightsView.jsx:361-431`. *(Count-based volume forecast; no explicit seasonal-index decomposition.)* |
| 1.5 | Smart inventory/sales optimization: underperforming assets + promo/restock suggestions | 🟡 | **Underperforming detection ✅** (`dashboard.service.ts:228`, never-rented items). **Suggestions 🟡** — promo/restock advice is hard-coded heuristic text in `AIInsightsView.jsx:174-189`, not AI-generated optimization. |

## 2. Boutique Staff

| FR | Requirement | Verdict | Evidence & Notes |
|----|-------------|---------|------------------|
| 2.1 | Secure staff login to management interface | ✅ | Same login, `role==='Staff'` → staff dashboard/tasks. |
| 2.2 | Full rental lifecycle in centralized DB (create → release → return) | ✅ | `StaffNewRental.jsx` wizard + `ReleaseItemModal.jsx` + `ProcessReturnModal.jsx`; backend `createRental`/`releaseRental`/`processReturn` all persist to shared DB with audit logs. |
| 2.3 | Record **and update** customer info + booking details | 🟡 | **Record ✅** — walk-in customer auto-provisioned on booking (`App.jsx:260-269`). **Update ❌** — no staff customer-management/edit UI, no staff customer-update endpoint (`customer.controller.ts` is customer self-service), and **no booking-edit endpoint** (corrections require cancel + rebook). |
| 2.4 | Search/retrieve historical records via web | ✅ | `HistoryView.jsx` (search, status + date-range filters, CSV export), `GlobalSearchModal.jsx`, transaction detail modal. |
| 2.5 | Photo condition tracking: before-release **and** upon-return, linked to the transaction | 🟡 (notable gap) | Both photos capture fine, but **(a)** release and return write the **same `Transaction.conditionPhoto` column** → return **overwrites** the release photo (`transactions.service.ts:373` & `:259`; single `condition_photo` in schema); **(b)** photos are kept only as **session blob URLs, never uploaded** to storage (`URL.createObjectURL`, never via `storageService.upload`). Net: condition photos are ephemeral + not before/after comparable. |
| 2.6 | Real-time inventory status auto-update (Available/Rented/Cleaning/Damaged) | ✅ (minor gap) | Auto transitions server-side: book→Rented/Reserved, release→Rented, return→Cleaning, cancel→Available. Live status colors in `ItemCard.jsx`/Catalog. *Minor:* a **damaged return sets item to `Cleaning`, not `Damaged`** (manual flip needed). |
| 2.7 | Automated late-return penalty + damage fee calc from business rules | 🟡 | **Calc ✅** — `fees.ts` (₱500/day late, ₱1,000 damage) auto-applied in `processReturn`. **"Predefined business rules" 🟡** — constants are **hardcoded**; the configurable `settings/rules` store is **not consulted**, so editing rules in settings has no effect on fees. |

## 3. Customers

| FR | Requirement | Verdict | Evidence & Notes |
|----|-------------|---------|------------------|
| 3.1 | Remotely browse digital catalog | ✅ | `CatalogView.jsx` customer grid + guest browsing (no auth on catalog route); images via signed URLs. |
| 3.2 | Login to personal portal + manage bookings | ✅ | 3-step signup, login/OAuth, "Transactions"/"Your Rentals" views, **cancel booking** (`HistoryView.jsx:365-378`). |
| 3.3 | AI customer assistant: recommendations + rental FAQ + guard rails | ✅ | `ChatbotModal.jsx` → `/ai/chat`; recommendations tied to **real inventory** (`findSuggestions` filters `Available`), FAQ covers Balayan location/process/fees, prompt-injection guardrails, customer-only + rate-limited route. |
| 3.4 | Date-specific availability checks | ✅ | Live availability check + blocked-date calendar in `CustomerRentalFlow.jsx`; **server-enforced** overlap `409` in `transactions.service.ts:74-85`; `GET /availability` endpoint. |
| 3.5 | Secure online booking + downpayment via digital payment | ✅ | Downpayment ≥ 50% enforced, recorded on tx; PayMongo hosted drop-in; **simulated fallback** when `PAYMONGO_SECRET_KEY` unset. Webhook signature verified. |
| 3.6 | Proactive SMS: booking confirmation + return-deadline reminder (Semaphore) | 🟡 (real gap) | **Booking confirmation SMS → customer ✅** (`transactions.service.ts:160`). **Return-deadline reminder → 🟡 staff-only in-app** — `notifyDueToday` never texts the customer: it only calls `notifyStaffMembers` and doesn't even select `customer.phone` (`sms.service.ts:139-171`). The only customer-directed SMS is the **overdue** notice, which is reactive, not proactive. |

---

## Scorecard

| Stakeholder | ✅ | 🟡 | ❌ | Total |
|-------------|:--:|:--:|:--:|:-----:|
| 1. Owner/Admin | 4 | 1 (1.5) | 0 | 5 |
| 2. Staff | 4 | 3 (2.3, 2.5, 2.7) | 0 | 7 |
| 3. Customer | 5 | 1 (3.6) | 0 | 6 |
| **Total** | **13** | **5** | **0** | **18** |

**No requirement is entirely missing.** 13 fully achieved, 5 partial.

---

## The 5 gaps (and whether the NFR plan covers them)

| # | Gap | In `NFR_GAP_PLAN.md`? |
|---|-----|------------------------|
| 1 | **FR 3.6** — return-deadline SMS not customer-facing (staff-only in-app). Fix: add `sendSms` to `tx.customer` in `notifyDueToday` + select `phone`. | ✅ Covered — Phase 3, step 8 |
| 2 | **FR 2.5** — release/return photo overwrite **+ never persisted to storage**. Fix: separate `releasePhoto`/`returnPhoto` columns (Phase 1, step 4) **AND wire `ReleaseItemModal`/`ProcessReturnModal` to upload via `storageService`** (the persist half must be added). | 🟡 Partially — add the persist-to-storage half |
| 3 | **FR 2.3** — no staff customer/booking *edit*. Fix: customer-edit UI + endpoint, and/or booking-edit endpoint. | ❌ Not in plan |
| 4 | **FR 2.7** — fee rules hardcoded, settings not consulted. Fix: make `calculateFees` read from the `BusinessRule` store. | ❌ Not in plan |
| 5 | **FR 1.5** — optimization suggestions are static text, not AI-generated. Fix (optional): have Gemini generate promo/restock suggestions from underperforming data. | ❌ Not in plan |
