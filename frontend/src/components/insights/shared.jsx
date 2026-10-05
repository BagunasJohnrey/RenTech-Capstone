// Shared bits for the Business Intelligence cards: formatting, chart
// tooltips, lookup tables, and the AI-report recommendation extractor.
// Pure presentational helpers — no state, no fetching.

import { Clock, AlertTriangle, RotateCcw, XCircle } from 'lucide-react';
import { TX_STATUS_HEX } from '../../utils/statusColors';

export const fmt = (n) => `₱${Math.round(Number(n)).toLocaleString()}`;
export const shortMonth = (l) => l?.split(' ')[0] || '';

export const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-bold text-gray-900 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-gray-600" style={{ color: p.color }}>
          {p.name}: {p.name.includes('Revenue') ? fmt(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

// Revenue-chart tooltip: shows the full "Mar 2026" label and clearly marks the
// projection bar so it isn't mistaken for actual revenue. In-progress weeks
// get their own line so a partial week never reads as a slow week, and
// projections with a range show it in plain words ("usually between ₱X–₱Y").
export const RevenueTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-bold text-gray-900">{p.full}{p.forecast ? ' (projected)' : ''}</p>
      <p className="text-gray-600">{p.rev <= 0 && !p.forecast ? 'No revenue' : fmt(p.rev)}</p>
      {p.wip && !p.forecast && <p className="text-[11px] text-gray-400 italic">Still ongoing — naturally lower</p>}
      {p.forecast && Array.isArray(p.whisker) && p.whisker.length === 2 && (
        <p className="text-[11px] text-gray-400 italic">Usually between {fmt(p.whisker[0])}–{fmt(p.whisker[1])}</p>
      )}
    </div>
  );
};

export const STATUS_COLORS = { Active: TX_STATUS_HEX.Active, Overdue: TX_STATUS_HEX.Overdue, Returned: TX_STATUS_HEX.Returned, Cancelled: TX_STATUS_HEX.Cancelled };
export const STATUS_ICONS = { Active: Clock, Overdue: AlertTriangle, Returned: RotateCcw, Cancelled: XCircle };

export const TIME_OPTIONS = ['Overall', 'Yearly', 'Monthly'];

export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Philippine event/seasonality annotations for the monthly forecast chart
// (display only for now — the SMA math itself is unweighted).
export const SEASON_MARKERS = {
  0: 'New Year', 1: "Valentine's", 2: 'Graduation', 5: 'Wedding season',
  9: 'Halloween', 11: 'Christmas · Wedding season',
};
export const CONFIDENCE_STYLES = {
  low: 'bg-amber-50 text-amber-700',
  medium: 'bg-blue-50 text-blue-700',
  high: 'bg-emerald-50 text-emerald-700',
};

// Pulls the numbered recommendations out of the AI report text. Provider models
// format loosely (markdown **bold** headers, "Recommendations:", trailing
// colons), so this accepts a header with optional markdown framing and falls
// back to any numbered lines — the prompt forces recommendations to be numbered
// 1..N with no gaps, so numbered lines are almost always the recommendation list.
export function extractRecommendations(report) {
  if (!report) return [];
  const lines = String(report)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const strip = (l) =>
    l
      .replace(/^[#*_>-\s]+/, '')
      .replace(/\s*[#*_>]+$/, '')
      .trim()
      .replace(/^\d{1,2}[.)]\s*\*{0,2}\s*/, '')
      .trim();

  const isHeader = (l) => /^[\s#*_>]*recommendations\s*:?[\s#*_]*$/i.test(l);

  const isMeta = (l) =>
    /^([-#\d.]*)?\s*(executive summary|key performance indicators?|revenue analysis|inventory\s*&?\s*utilization|operational health|demand forecast|data:|kpis?:|insights?:|forecast:|underperforming items)/i.test(l);

  const idx = lines.findIndex(isHeader);
  if (idx !== -1) {
    const recs = lines.slice(idx + 1).map(strip).filter((l) => l.length > 10 && !isMeta(l));
    if (recs.length) return recs;
  }

  const numbered = lines
    .filter((l) => /^\d{1,2}[.)]\s+\S/.test(l))
    .map(strip)
    .filter((l) => l.length > 10);
  return numbered;
}
