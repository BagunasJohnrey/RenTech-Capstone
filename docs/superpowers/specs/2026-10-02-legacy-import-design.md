# Legacy Data Import — Design (draft, continue later)

Date: 2026-10-02 · Status: design only, no code yet

## 1. Intent

Import the boutique's old shop records so the rule-based Demand Forecast (SMA),
revenue charts, KPIs, and AI report gain real history.

## 2. What we know about the legacy data

- Columns: **customer name + category + payment + date** (no exact item name).
- File format: **mixed / not sure yet** — the importer must accept messy CSVs.
- Desired effect (confirmed): rows show up in **forecast + revenue + reports**
  (i.e. they become real `Returned` history, not a hidden forecast-only store).
- Item linkage (confirmed): customer name exists; only the item name is missing,
  so per-category placeholder items are the intended bridge.

## 3. Design (bounded change, pending approval)

### 3.1 Backend: `POST /api/settings/legacy-import` (Admin-only)

- Same guard level as the backup restore in `DataBackupsTab.jsx`.
- Two-step: `dryRun preview → confirm`.
- Forgiving CSV parser:
  - Case-insensitive headers: `customer/customer_name/name`,
    `category/item_type`, `payment/amount/rental_fee`, `date/rental_date`.
  - Strips BOM/quotes, tolerates Excel-saved CSVs.
  - Accepts `YYYY-MM-DD` plus common variants; per-row errors reported
    without aborting valid rows.
- Preview returns: valid/invalid row counts, per-row errors, category totals,
  date range, revenue sum — nothing written.
- Confirm writes, per row:
  - **Item:** find-or-create one placeholder per distinct category,
    e.g. `Legacy – Gown` (`status: Available`, `price` = median payment for
    that category, description tagged legacy). This keeps the existing
    `itemId → InventoryItem.category` forecast join working with zero schema
    change (`backend/src/services/dashboard.service.ts:334-338`).
  - **Customer:** match `Profile` by case-insensitive name first; else create a
    synthetic walk-in profile (`walkin_*@rentech.invalid`, no login), reusing
    the existing pattern in `backend/src/controllers/transactions.controller.ts:77-84`.
  - **Transaction:** one `Returned` row per legacy record —
    `rentalDate = dueDate = returnDate = date`, **`createdAt = date`** (so SMA
    buckets land in the right month), `rentalFee = downpayment = totalPaid =
    payment`, `balance = 0`, `notes = legacy:{batchId}`.
  - **Payment:** one `succeeded` row per transaction (same date/amount) so the
    revenue charts (which prefer payments) pick it up.
- Idempotency/rollback: every batch tagged `legacy:{batchId}` in notes;
  re-upload of the same batch warns in preview; `DELETE …/legacy-import/{batchId}`
  removes exactly that batch.
- Clears the dashboard cache after import so the forecast updates immediately.

### 3.2 Frontend: `LegacyImportCard` in Data & Backups

- New card inside the existing Data & Backups tab (`AdminSectionTabs.jsx: `data``),
  next to the backup import in `DataBackupsTab.jsx` — same preview →
  confirm → result-summary UX.
- Controls: template CSV download, `.csv` file picker, preview table,
  confirm button, result summary. Admin-only.

### 3.3 Files touched (expected)

- NEW `backend/src/services/legacyImport.service.ts` (parser + import + rollback).
- `backend/src/routes/settings.routes.ts` + controller (endpoint, Admin guard).
- `frontend/src/components/settings/DataBackupsTab.jsx` (+ NEW
  `frontend/src/components/settings/LegacyImportCard.jsx`).
- NEW `backend/tests/legacyImport.test.ts`.

### 3.4 Testing

- `backend/tests/legacyImport.test.ts`: header variants, bad-date rows skipped,
  placeholder items created once per category, payment rows written,
  duplicate-batch guard, rollback deletes only its batch.
- `tsc` clean, full vitest pass, `vite build` pass.
- Manual QA: 10-row CSV across 2 categories → forecast SMA moves, revenue
  appears in the right months, batch rollback removes it.

## 4. Open items (for next session)

1. Confirm the exact CSV column names once a sample file exists (update §3.1).
2. Decide category canonicalization (e.g. `gown` vs `Gown` vs `Gowns`) — propose
   normalizing against existing `InventoryItem.category` values with an
   "unmapped categories" step in preview.
3. Decide whether legacy customers should be excluded from SMS/email (likely yes —
   synthetic `@rentech.invalid` addresses already skip Brevo).
4. Decide MFA requirement on the endpoint (backup restore requires Admin + MFA).
5. Sample rows to test with (paste 2–3 when available).

## 5. Gate

Design presented in chat 2026-10-02. Implementation starts only after explicit
approval. Next step after approval: implement §3.1–§3.3 via the normal
development workflow (TDD, no plan document — bounded task).
