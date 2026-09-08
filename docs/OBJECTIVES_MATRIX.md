# Objectives → Evidence Matrix (Capstone Defense)

Each thesis objective mapped to the shipped feature, where to prove it in
code/tests, and the one demo step that shows it live.

## 1. Rental Management System

| # | Objective | Feature | Code / test evidence | Demo step |
|---|---|---|---|---|
| 1.1 | Role-Based Access Control | Admin / Staff / Customer roles; `requireRole` on every route; admin MFA gates on sensitive routes; role-branched nav + Unauthorized page; forced password change for staff OTP accounts | `backend/src/middleware/rbac.ts`, `backend/src/routes/*.routes.ts`, `frontend/src/App.jsx` navItems, `frontend/src/utils/routing.js` | Log in as each role; open another role's URL → Unauthorized page |
| 1.2 | Transaction Management | Create / edit / return (intact→Cleaning, damaged→OutOfService) / release / cancel / delete; late + damage fees from BusinessRules; audit log on every mutation | `backend/src/services/transactions.service.ts`, `backend/tests/transactions.test.ts`, `frontend/src/pages/HistoryView.jsx`, `StaffTasksView.jsx` | Staff: new rental → return intact (Cleaning) → bulk "Mark Cleaned"; damaged return with reason (Out of Service) |
| 1.3 | Real-Time Inventory Monitoring | Unified lifecycle (Available/Rented/Reserved/Cleaning/OutOfService/Deleted); single `effectiveStatus` source; **45s polling** on today-digest + KPIs; no-show/overdue scheduler (60s) | `frontend/src/hooks/useDashboard.js` (`POLL_MS`), `backend/src/services/inventory.service.ts` (`listItems`/`getItem`), `frontend/src/hooks/useInventory.js` normalize | Keep dashboard open, process a return on another tab → counts update ≤45s |

## 2. Customer Booking Interface

| # | Objective | Feature | Code / test evidence | Demo step |
|---|---|---|---|---|
| 2.1 | Online Booking System | 3-step customer flow (details → payment → receipt); server-derived pricing; ≥50% downpayment enforced server-side; promo codes; booking + QR receipt (save as PNG) | `frontend/src/components/CustomerRentalFlow.jsx`, `backend/src/controllers/customer.controller.ts`, `backend/tests/customer.test.ts` | Book as customer → receipt → Save Receipt PNG |
| 2.2 | Product Browsing + Availability | Catalog search/filter/sale + Home recommendations; shared overlap engine (Active/Overdue/Reserved + cleaning buffer); blocked-dates calendar; PII-stripped public endpoints | `backend/src/utils/availability.ts`, `frontend/src/pages/CatalogView.jsx`, `frontend/src/components/BookingCalendar.jsx` | Pick conflicting dates → honest "not available"; pick free dates → books |
| 2.3 | Customer Notifications | In-app (bell + full page, tap-to-navigate); SMS day-0 / day-N escalation / due-today / no-show on a 60s scheduler; Brevo email for booking/pickup/return/cancel/reminders; per-customer opt-outs | `backend/src/services/sms.service.ts`, `brevo.service.ts`, `backend/tests/sms.test.ts`, `brevo.test.ts` | Return late → staff + customer alerts; toggle prefs in Profile Settings |
| 2.4 | Secure Online Payment | PayMongo intent (server-side amount bounds, ownership checks); HMAC webhook + `paymongoPiId` idempotency; drop-in UI | `backend/src/services/paymongo.service.ts`, `controllers/payments.controller.ts`, `backend/tests/payments.test.ts` | **Currently simulated** (`PAYMONGO_SIMULATE=true`) — set live keys + webhook secret to collect real money |

## 3. System Intelligence & Forecasting

| # | Objective | Feature | Code / test evidence | Demo step |
|---|---|---|---|---|
| 3.1 | AI Insights + Assistant | DB-grounded stylist (Gemini→Groq→OpenRouter, guardrails, source pills, sale-aware); admin report with anti-hallucination amount guard + PDF export | `backend/src/services/gemini.service.ts`, `frontend/src/components/ChatbotModal.jsx`, `frontend/src/pages/AIInsightsView.jsx` | Ask stylist for a wedding look (real items only); Generate Report → PDF |
| 3.2 | Rule-Based Demand Forecasting | Monthly + **weekly** SMA buckets, **per-category** series, **next-3-period** projections (`?granularity=`, `?period=1-12`); confidence labeled by history depth; season markers on chart | `backend/src/services/dashboard.service.ts` (`getForecast`), `backend/src/utils/sma.ts`, `backend/tests/ai-dashboard.test.ts` | AI Insights → Demand Forecast chart + 3-period outlook table |
| 3.3 | Smart Inventory & Sales Optimization | Deterministic rules (`utils/optimization.js` + backend twin `optimization.service.ts`, fed to the AI report as facts): **restock** (projection outruns free units), **clearance** (idle 60d+ / never rented → sale), **clean-next** queue by projected demand; manual per-item sales (admin-only) | `frontend/src/utils/optimization.js`, `backend/src/services/optimization.service.ts`, `backend/tests/optimization.test.ts`, `frontend/src/pages/AIInsightsView.jsx` (Smart actions row), `backend/.../inventory.controller.ts` (`assertSaleAdminOnly`) | Smart actions row: restock +N, clearance list, cleaning order |
| 3.4 | Revenue Monitoring + Projections | Monthly/weekly revenue charts with projected bars, KPI cards, AI revenue analysis, branded PDF + CSV exports | `backend/src/services/dashboard.service.ts` (`getKpis`/`getInsights`), `frontend/src/utils/reportPdf.js` | Revenue chart → hatched projection bar; export PDF |

## Known limitations (say them before the panel does)

- 2.4 is simulated until live PayMongo keys are set (flagged `simulated: true` everywhere; health probe says so).
- AI providers are quota-sensitive; the UI degrades to static insights with an explicit toast (never silent, never invented).
- Forecast is SMA-based (recent-average projection), not seasonal ML — state it as "rule-based baseline, ML-ready".
