# Forecast Method (§ demand-forecast / § revenue) — paste-ready

> Companion to `docs/FORECAST_UPGRADE_PLAN.md`. Copy the two paragraphs below
> straight into the manuscript; the revision log underneath is panel-safe.

## Demand forecast paragraph

Rental demand is projected with a simple moving average (SMA) over completed
booking counts, keeping the approved engine while adding standard
honest-forecasting practice. The averaging window adapts to history depth
(three periods when available, fewer on thin histories, and the forecast is
labeled early while still learning), so a young store gets a provisional
trend instead of a dead card. One-time spikes — bulk bookings that would
otherwise inflate the average for months — are capped out of the averaging
calculation only; the underlying bars always show true counts, and each
excluded spike is flagged on the chart in plain words. Accuracy is measured,
not assumed: the system backtests one-step-ahead residuals over the trailing
periods into a mean absolute percentage error (MAPE, zero-volume periods
excluded) and draws the expected range as a shaded band around the trend, so
the report states its own uncertainty instead of a false-precise point.

## Revenue paragraph

Next-week revenue blends two independent signals equally: the current
month's daily collection pace and the weekly rental trend multiplied by the
average ticket. The projection carries an uncertainty whisker of one sample
standard deviation over the last four finished weeks, and the still-ongoing
week is marked lighter, excluded from week-over-week comparisons, and labeled
so a partial week never reads as a slow week. At month-end, when pace is
zero by definition, the bar becomes the full trend projection for next
month's first week rather than disappearing. Peso projections render only
when the average ticket is known from real data; otherwise the card shows
rental counts with a maturing-data note instead of a guessed peso figure.

## Revision log

| # | Change | Why | Files |
|---|--------|-----|-------|
| 1 | Peso bars render only when the average ticket is known; Forecast KPI shows "price data maturing" otherwise | Counts were rendering as ₱ (unit-mix bug) | `AIInsightsView.jsx`, `KpiCards.jsx` |
| 2 | In-progress week marked lighter + labeled, excluded from deltas | Partial weeks read as slow weeks | `AIInsightsView.jsx`, `RevenueChart.jsx`, `shared.jsx` |
| 3 | Adaptive SMA window (min 3, history depth) + early-forecast label | Thin histories got a dead card | `dashboard.service.ts`, `utils/sma.ts` |
| 4 | Spike capping (IQR / ±2σ) with plain-word flags; bars keep true counts | One bulk booking inflated the trend for months | `utils/sma.ts`, `dashboard.service.ts`, `DemandForecast.jsx` |
| 5 | Backtested MAPE + expected-range band on the trend chart | Point forecasts hid their own error | `utils/sma.ts`, `dashboard.service.ts`, `DemandForecast.jsx` |
| 6 | Blended Next Wk (pace + trend), whisker, WoW deltas, best-week star, month-end fallback | Pace-only projection vanished at month-end | `AIInsightsView.jsx`, `RevenueChart.jsx`, `shared.jsx` |

Defense line: *"The forecast keeps the approved SMA engine and adds standard
honest-forecasting practice: spike capping, adaptive windowing, and a
backtest-measured error band — so the system reports its own uncertainty
instead of a false-precise point."*
