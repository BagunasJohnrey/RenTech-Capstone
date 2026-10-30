import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatMoney, formatCompactMoney, TONE_COLORS } from '../utils/reportVisuals';

const ACCENT = '#bf4a53';

function formatValue(v, format) {
  if (format === 'money') return formatMoney(v);
  if (format === 'pct') return `${v}%`;
  return Number(v).toLocaleString('en-PH');
}

function ChartTitle({ children, note }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{children}</p>
      {note && <p className="text-[10px] text-gray-400">{note}</p>}
    </div>
  );
}

function KpiTiles({ tiles }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 truncate">{t.label}</p>
          <p
            className="text-lg font-bold tabular-nums leading-tight mt-0.5 truncate"
            style={{ color: t.tone === 'critical' ? TONE_COLORS.critical : '#111827' }}
          >
            {formatValue(t.value, t.format)}
          </p>
          {t.meter != null && (
            <div className="h-1.5 rounded-full bg-gray-200 mt-1.5 overflow-hidden" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, t.meter)}%`, backgroundColor: ACCENT }} />
            </div>
          )}
          {(t.delta != null || t.sub) && (
            <p className="text-[10px] text-gray-500 mt-1 flex items-center gap-1 min-w-0">
              {t.delta != null && (
                <span
                  className="inline-flex items-center gap-0.5 font-bold shrink-0"
                  style={{ color: t.delta >= 0 ? TONE_COLORS.good : TONE_COLORS.critical }}
                >
                  {t.delta >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {Math.abs(t.delta).toFixed(1)}%
                </span>
              )}
              {t.sub && <span className="truncate">{t.sub}</span>}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// 100% stacked bar: share of rentals by status, legend carries the counts.
function StackedShare({ title, parts, unit = 'rentals' }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <ChartTitle note={`${total.toLocaleString('en-PH')} ${unit}`}>{title}</ChartTitle>
      <div className="flex h-3 rounded-full overflow-hidden gap-[2px] bg-white">
        {visible.map((p) => (
          <div
            key={p.label}
            title={`${p.label}: ${p.value.toLocaleString('en-PH')} (${((p.value / total) * 100).toFixed(0)}%)`}
            style={{ width: `${(p.value / total) * 100}%`, backgroundColor: TONE_COLORS[p.tone] }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: TONE_COLORS[p.tone] }} />
            {p.label}
            <span className="font-semibold text-gray-900 tabular-nums">{p.value.toLocaleString('en-PH')}</span>
            <span className="text-gray-400 tabular-nums">{total ? `${((p.value / total) * 100).toFixed(0)}%` : ''}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Horizontal bars, one series, value label at the bar end.
function BarList({ title, note, rows, format = (v) => v, extra }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <div>
      <ChartTitle note={note}>{title}</ChartTitle>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] sm:grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2" title={`${r.label}: ${format(r.value)}`}>
            <span className="text-[11px] text-gray-600 truncate">{r.label}</span>
            <div className="h-2.5 rounded-r bg-gray-100">
              <div className="h-full rounded-r" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, backgroundColor: ACCENT }} />
            </div>
            <span className="text-[11px] font-semibold text-gray-900 tabular-nums inline-flex items-center gap-1 justify-end min-w-[3.5rem]">
              {format(r.value)}
              {extra?.(r)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Rented vs total units per category: the full track is the stock, the fill is rented.
function CategoryFill({ rows }) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div>
      <ChartTitle note="filled = rented, track = total units">Units rented by category</ChartTitle>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] sm:grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2" title={`${r.label}: ${r.rented} of ${r.total} rented`}>
            <span className="text-[11px] text-gray-600 truncate">{r.label}</span>
            <div className="h-2.5 rounded-r bg-gray-100" style={{ width: `${(r.total / max) * 100}%` }}>
              <div className="h-full rounded-r" style={{ width: `${r.total ? Math.min(100, (r.rented / r.total) * 100) : 0}%`, backgroundColor: ACCENT }} />
            </div>
            <span className="text-[11px] font-semibold text-gray-900 tabular-nums text-right min-w-[3.5rem]">
              {r.rented}<span className="text-gray-400 font-normal"> / {r.total}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TREND_ICON = {
  up: <TrendingUp size={11} style={{ color: TONE_COLORS.good }} aria-label="trending up" />,
  down: <TrendingDown size={11} style={{ color: TONE_COLORS.critical }} aria-label="trending down" />,
  flat: <Minus size={11} className="text-gray-400" aria-label="flat" />,
};

/** Charts for one report section; renders nothing when the section has none. */
export default function ReportVisuals({ visuals }) {
  if (!visuals) return null;
  const { tiles, status, revenueByCategory, stock, categoryBreakdown, topItems, projections } = visuals;
  const blocks = [];

  if (tiles?.length) blocks.push(<KpiTiles key="tiles" tiles={tiles} />);
  if (status?.length) blocks.push(<StackedShare key="status" title="Rentals by status" parts={status} />);
  if (revenueByCategory?.length) {
    blocks.push(
      <BarList key="rev" title="Revenue by category" rows={revenueByCategory} format={formatCompactMoney} />
    );
  }
  if (stock) {
    blocks.push(
      <StackedShare
        key="stock"
        title="Inventory right now"
        unit="items"
        parts={[
          { label: 'In use', value: stock.inUse, tone: 'info' },
          { label: 'Available', value: stock.available, tone: 'muted' },
        ]}
      />
    );
  }
  if (categoryBreakdown?.length) blocks.push(<CategoryFill key="cat" rows={categoryBreakdown} />);
  if (topItems?.length) {
    blocks.push(<BarList key="top" title="Most-rented items" note="rentals" rows={topItems} />);
  }
  if (projections?.length) {
    blocks.push(
      <BarList
        key="proj"
        title="Projected rentals per month"
        note="by category"
        rows={projections}
        format={(v) => (Number.isInteger(v) ? v : v.toFixed(1))}
        extra={(r) => TREND_ICON[r.trend]}
      />
    );
  }

  if (!blocks.length) return null;
  return <div className="report-visuals space-y-4 mb-4">{blocks}</div>;
}

function TableBlock({ columns, align, rows }) {
  return (
    <table className="w-full text-[12.5px] border-collapse">
      <thead>
        <tr className="bg-gray-50">
          {columns.map((c, i) => (
            <th key={c} className={`px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-gray-500 border-b border-gray-200 ${align[i] === 'right' ? 'text-right' : 'text-left'}`}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-gray-100 last:border-0">
            {r.map((cell, ci) => (
              <td key={ci} className={`px-3 py-1.5 ${ci === 0 ? 'text-gray-700' : 'font-semibold text-gray-900 tabular-nums'} ${align[ci] === 'right' ? 'text-right' : 'text-left'}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A section's figures as a table; long metric lists split into two columns. */
export function ReportTable({ table }) {
  const split = table.rows.length > 8 && table.columns.length === 2;
  const half = Math.ceil(table.rows.length / 2);
  return (
    <div className="mb-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{table.title}</p>
      {split ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-gray-200 overflow-hidden"><TableBlock {...table} rows={table.rows.slice(0, half)} /></div>
          <div className="rounded-lg border border-gray-200 overflow-hidden"><TableBlock {...table} rows={table.rows.slice(half)} /></div>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-hidden overflow-x-auto"><TableBlock {...table} /></div>
      )}
    </div>
  );
}
