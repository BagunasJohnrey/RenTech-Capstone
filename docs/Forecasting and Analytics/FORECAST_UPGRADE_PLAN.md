# Forecast & Revenue Upgrade Plan — SMA, Demand Forecast & Weekly Revenue

> Scope: make the Demand Forecast and Weekly Revenue cards accurate, admin-useful, and
> informative on thin history (1 month today). No schema changes, no new dependencies,
> no new external APIs. Matches the simplified draft in `docs/forecast-draft.html`.
> Render this file in any Mermaid-capable viewer (GitHub, VS Code + Mermaid preview).

---

## 0. Problem Statement (what the screenshots show)

```mermaid
flowchart LR
    subgraph TODAY["TODAY (thin history, 1 month)"]
        F1["Demand Forecast\nSMA(3) needs 3 points\n→ 0 valid → dead card:\n'3 more months needed'"]
        R1["Weekly Revenue\nNext Wk = pace only\n→ vanishes at month-end\n→ partial Wk 4 looks full"]
        B1["Projection bar mixes units:\ncounts rendered as ₱\nwhen avg price unknown"]
    end
    subgraph TARGET["TARGET (same data, honest math)"]
        F2["Weekly-default forecast\nadaptive period\nspike-capped SMA + band"]
        R2["Blended Next Wk\npace + SMA demand\nwith range + WIP marking"]
        B2["Peso bars only when\navg ticket is known"]
    end
    TODAY -->|"this plan"| TARGET
```

Root cause is not the UI — it is **SMA(3) on 1 data point** plus a **pace-only revenue
projection**. Every fix below works on the data the boutique already has.

---

## 1. Workstream Map

```mermaid
flowchart TD
    A["P1 — Accuracy fixes\n(must-ship)"] --> B["P2 — Forecast upgrades\n(trust)"]
    B --> C["P3 — Revenue upgrades\n(clarity)"]
    C --> D["P4 — Polish + manuscript\n(defense)"]
    A --> A1["A1 unit-mix guard"]
    A --> A2["A2 in-progress week marking"]
    B --> B1["B1 adaptive SMA period"]
    B --> B2["B2 weekly-default + bridge"]
    B --> B3["B3 spike-capped SMA"]
    B --> B4["B4 MAPE band + error %"]
    C --> C1["C1 blended Next Wk"]
    C --> C2["C2 month-end fallback"]
    C --> C3["C3 WoW deltas + best week"]
    D --> D1["D1 plain-language footnotes"]
    D --> D2["D2 simplified labels"]
    D --> D3["D3 manuscript § update"]
```

**Ship order: P1 → P2 → P3 → P4.** Each phase is independently releasable; P1 alone
fixes a real mislabeling bug.

---

## 2. P1 — Accuracy Fixes

```mermaid
flowchart TD
    Q1["A1 — Unit-mix guard\nAIInsightsView.jsx:398-401"]
    Q1 --> IF1{"avgPriceKnown?"}
    IF1 -->|"yes"| OK1["Peso projection bar\nas today"]
    IF1 -->|"no"| FIX1["Hide peso bar\nshow rental-count projection\n+ 'price data maturing' note"]
    Q2["A2 — In-progress week\nAIInsightsView.jsx:473-478"]
    Q2 --> FIX2["Current week bar:\nhatched/lighter fill\n'in progress · day N of 7' tooltip\nnever compared 1:1 in deltas"]
```

- **A1** — one-line guard. Today `forecastRevValue` falls back to a rental *count* that
  still renders as a *peso* bar. With 1 month of history this is the live bug.
- **A2** — data already available (`weekIdx` trim exists); only the *marking* is new.
  Frontend-only, zero backend change.

---

## 3. P2 — Forecast Upgrades (backend)

```mermaid
flowchart TD
    S["sma(data, period)\nutils/sma.ts"] --> S1["NEW: smaCapped(data, period)\nIQR (or ±2σ under n<8)\ncap spikes, return { values, flags }"]
    D["getForecast()\ndashboard.service.ts"] --> D1["B1: period = min(3, nNonZero)\nlabel provisional when < 3"]
    D --> D2["B2: weekly is default source\nwhen monthly history < 3"]
    D --> D3["B3: monthly SMA runs on\ncapped series; flags[] returned"]
    D --> D4["B4: backtest MAPE\nlast min(8, n) residuals\n→ errorPct + band lo/hi"]
    S1 --> D3
    D1 --> OUT["{ labels, counts, sma, flags,\nerrorPct, band, provisional,\nconfidence, confidenceNote }"]
    D2 --> OUT
    D3 --> OUT
    D4 --> OUT
```

API contract (additive — old clients ignore new fields):

```json
{
  "counts": [6, 9, 7, 14, 8, 10, 9, 12],
  "sma": [null, null, 7.3, 8.7, 9.7, 10.7, 9.0, 10.3],
  "flags": [{ "index": 3, "reason": "bulk booking — capped at 9" }],
  "errorPct": 12,
  "provisional": true,
  "confidence": "medium",
  "confidenceNote": "Based on 8 weeks of history · medium confidence · error ±12%"
}
```

Rules:
- Capping never deletes data — bars show true counts; only the *average* uses capped
  values. Flag text is user-facing, no jargon ("bulk booking", never "IQR winsorized").
- MAPE skips zero-actual periods (division-by-zero guard).
- `confidence()` thresholds unchanged (`low <4mo, medium <8mo`); the note gains `· error ±X%`.
- Cache keys unchanged (`forecast:{period}:{granularity}`); warmer in
  `dashboard.service.ts:12-20` needs no edit.

---

## 4. P3 — Revenue Upgrades (mostly frontend)

```mermaid
flowchart TD
    P["Blended Next Wk\nAIInsightsView.jsx:494-502"] --> F["pace = thisMonthRev / today"]
    P --> G["demand = weeklySMA × avgTicket\n(from forecast bundle, already fetched)"]
    F --> H["nextWk = 0.5·pace + 0.5·demand"]
    G --> H
    H --> I{"daysLeft == 0?"}
    I -->|"no"| J["Bar + range whisker\n±1 stddev of prior 4 weeks"]
    I -->|"yes"| K["Full SMA projection\nfor next month Wk 1\n(never hide the bar)"]
    L["WoW deltas + best week\npure presentational"] --> M["+30% / −10% labels\n★ best marker\npartial weeks excluded"]
```

- Uses the already-fetched forecast bundle — **zero extra requests**.
- Range whisker = sample stddev of the 4 completed weekly revenues (n<2 → hide whisker,
  show point only).
- Tooltip copy: *"Projected, usually between ₱19k–₱25k"* (plain language per draft).

---

## 5. P4 — Polish + Manuscript

```mermaid
flowchart LR
    subgraph UI["Label simplification (frontend-only)"]
        L1["SMA (3mo) → Average trend"]
        L2["±1 stddev → usually between X–Y"]
        L3["IQR winsorized → one-time spike excluded"]
        L4["Method footnote under each card"]
    end
    subgraph DOC["Manuscript (paste-ready, §11-style)"]
        M1["§ demand-forecast paragraph:\nSMA + capped spikes + MAPE band"]
        M2["§ revenue paragraph:\nblended projection + WIP marking"]
        M3["Revision log table\n6 rows, panel-safe"]
    end
    UI --> DOC
```

Footnote copy (exact strings for the draft):
- Forecast: *"May's bulk-booking spike is excluded from the average so it doesn't
  inflate the forecast. December is adjusted for the Christmas rush."*
- Revenue: *"Next week blends this month's daily pace with the rental trend × ₱1,450
  average ticket. Wk 4 is still ongoing, so it will naturally look lower."*

---

## 6. File Map

```mermaid
flowchart TD
    B["backend/src/utils/sma.ts\n+ smaCapped() + mape()"] --> C["backend/src/services/dashboard.service.ts\ngetForecast(): adaptive period\ncapped series + flags + errorPct"]
    C --> F1["frontend/src/pages/AIInsightsView.jsx\nA1 guard + blended Next Wk\nWIP marking + deltas"]
    C --> F2["frontend/src/components/insights/DemandForecast.jsx\nband polygon + spike flag\nprovisional label + simplified copy"]
    F1 --> F3["frontend/src/components/insights/RevenueChart.jsx\nwhisker + hatch + tooltips"]
    F3 --> T["tests: backend/tests/forecast.test.ts\n(NEW — vitest)"]
```

| File | Change | Lines |
|---|---|---|
| `backend/src/utils/sma.ts` | add `smaCapped`, `mape` (pure fns) | +40 |
| `backend/src/services/dashboard.service.ts` | `getForecast` adaptive + flags + errorPct | ~+50 |
| `frontend/src/pages/AIInsightsView.jsx` | A1/A2/C1/C2/C3 | ~+60 |
| `frontend/src/components/insights/DemandForecast.jsx` | band + flags + copy | ~+40 |
| `frontend/src/components/insights/RevenueChart.jsx` | whisker + hatch + tooltips | ~+30 |
| `backend/tests/forecast.test.ts` | NEW | +80 |

No DDL. No env changes. No new packages (band/whisker/hatch are inline SVG).

---

## 7. Build Order (Gantt)

```mermaid
gantt
    title Forecast upgrade (single dev, no DDL)
    dateFormat YYYY-MM-DD
    section P1 accuracy
    A1 unit-mix guard + A2 WIP marking :a1, 2026-09-24, 1d
    section P2 forecast backend
    smaCapped + mape + tests           :b1, after a1, 1d
    getForecast adaptive+flags+errorPct :b2, after b1, 1d
    section P3 revenue frontend
    Blended Next Wk + whisker + deltas :c1, after b2, 1d
    section P4 polish
    Band + flags + copy + manuscript   :d1, after c1, 1d
```

---

## 8. Test & Acceptance Checklist

```mermaid
flowchart TD
    T1["vitest forecast.test.ts:\n• spike capped, flag emitted\n• period adapts 3→2 on 2 points\n• MAPE skips zero-actual weeks\n• provisional=true when < 3 pts\n• null layout: no crash on empty history"]
    T2["Manual QA (matches draft):\n• 1-month DB → weekly-default, no dead card\n• month-end → SMA bar, never hidden\n• peso bar hidden when avg unknown\n• WIP week hatched + excluded from deltas"]
    T3["Guardrails:\n• tsc clean, 276+ vitest pass\n• vite build pass\n• /catalog + /bookings latency unchanged"]
    T1 --> DONE["Acceptance = draft parity"]
    T2 --> DONE
    T3 --> DONE
```

Capstone defense line: *"The forecast keeps the approved SMA engine and adds
standard honest-forecasting practice: spike capping, adaptive windowing, and a
backtest-measured error band — so the system reports its own uncertainty instead
of a false-precise point."*
