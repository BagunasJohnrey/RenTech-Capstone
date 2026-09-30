// Date picker upgrade over the raw native inputs: a popover with a presets
// rail (Today / Yesterday / This week / This month / …) on the left and a
// two-month calendar on the right. One click picks a single day (from = to),
// a second click extends it into a range (auto-swap if the user clicks the
// earlier day second). Future dates are allowed — Transactions include
// Reserved rows with upcoming pickup dates — so there's no `max` clamp.
//
// Public surface: <DateRangePicker from={} to={} onChange={({from,to}) => {}} onClose={() => {}} boxed? />
// `boxed` swaps the floating pill trigger for a full-width boxed control that
// matches a sibling <select> (used in HistoryView's Sort + Date row).
// Internal draft state lives here so the parent only sees committed values
// when the user clicks Apply (or taps outside, which cancels).

import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

// Positions the popover against an anchor rect (desktop/tablet = the trigger
// button's rect). Matches the grid widths: < xl renders a ONE-month grid,
// xl+ renders TWO months side-by-side. Two thresholds separate "fits to the
// right of the trigger" from "flush to the right edge".
function usePopoverPosition(anchorRef, open, deps = []) {
  const [style, setStyle] = useState({});
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const popW = vw >= 1280 ? 308 : vw >= 768 ? 430 : Math.min(vw - 16, 430);
      // Keep 8px off whichever edge the popover leans toward.
      const left = r.left + popW > vw - 8 ? Math.max(8, vw - popW - 8) : Math.max(8, r.left);

      const estH = vw >= 1280 ? 450 : vw >= 768 ? 520 : 560;
      const spaceBelow = vh - r.bottom - 8;
      const placeBelow = spaceBelow >= Math.min(estH, 300) || r.top - 8 < 300;

      setStyle(placeBelow
        ? { position: 'fixed', top: r.bottom + 8, left, zIndex: 60 }
        : { position: 'fixed', bottom: vh - r.top + 8, left, zIndex: 60 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchorRef, ...deps]);
  return style;
}

function useViewportWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const fromISO = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };
const today = () => toISO(new Date());
const monthStart = (offset = 0) => { const d = new Date(); d.setMonth(d.getMonth() + offset, 1); return toISO(d); };

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const QUICK_RANGES = [
  { label: 'Today', from: today, to: today },
  { label: 'Yesterday', from: () => daysAgo(1), to: () => daysAgo(1) },
  { label: 'Last 7 days', from: () => daysAgo(6), to: today },
  { label: 'Last 30 days', from: () => daysAgo(29), to: today },
  { label: 'This month', from: () => monthStart(0), to: today },
];

function formatLabel(from, to) {
  if (!from && !to) return 'Any date';
  const fd = from ? fromISO(from) : null;
  const td = to ? fromISO(to) : null;
  if (fd && td && from === to) return fd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (fd && td) return `${fmt(fd)} → ${fmt(td)}`;
  if (fd) return `From ${fmt(fd)}`;
  return `Until ${fmt(td)}`;
}

function isSameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// One month grid. monthDate can be any day inside the month to render.
function MonthGrid({ monthDate, rangeStart, rangeEnd, hoverDate, onSelect, onHover, maxMonthOffset }) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const startWeekday = (first.getDay() + 6) % 7; // Monday-first columns
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const isToday = (d) => isSameDay(d, new Date());
  // Span math. A single-day pick (from === to) must render as just one black
  // dot, not as if every day of the month were between two stacked endpoints
  // — the previous version reported isLo=true for all cells in that case.
  const spanEnd = rangeEnd || hoverDate || '';
  const hasSpan = Boolean(rangeStart && spanEnd);
  const [lo, hi] = hasSpan
    ? (rangeStart <= spanEnd ? [rangeStart, spanEnd] : [spanEnd, rangeStart])
    : [rangeStart || null, rangeStart || null];
  const isSinglePoint = hasSpan && lo === hi;

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  return (
    // Fluid on narrow viewports (min-w-0 so the sheet can shrink under 252px),
    // exactly 252px on md+ where two months sit side-by-side.
    <div className="w-full min-w-0 select-none">
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const todayMark = isToday(d);
          const t = toISO(d);
          const isLo = hasSpan && t === lo;
          const isHi = hasSpan && t === hi;
          const between = hasSpan && t > lo && t < hi;

          let cell;
          if (isSinglePoint && isLo) {
            cell = <div className="w-full h-9 flex items-center justify-center"><div className="h-8 w-8 rounded-full bg-gray-900 text-white font-bold flex items-center justify-center text-[13px]">{d.getDate()}</div></div>;
          } else if (!isSinglePoint && (isLo || isHi)) {
            cell = (
              <div className={`w-full h-9 flex items-center justify-center bg-[#bf4a53]/10 ${isLo ? 'rounded-l-full' : 'rounded-r-full'}`}>
                <div className="h-8 w-8 rounded-full bg-gray-900 text-white font-bold flex items-center justify-center text-[13px]">{d.getDate()}</div>
              </div>
            );
          } else if (between) {
            cell = <div className="w-full h-9 flex items-center justify-center bg-[#bf4a53]/10 text-gray-800 text-[13px]">{d.getDate()}</div>;
          } else {
            cell = (
              <div className="w-full h-9 flex items-center justify-center">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[13px] text-gray-700 transition-colors hover:bg-gray-100 ${todayMark ? 'ring-1 ring-gray-900/30 font-semibold' : ''}`}>{d.getDate()}</div>
              </div>
            );
          }

          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(t)}
              onMouseEnter={() => onHover(t)}
              onFocus={() => onHover(t)}
              className="p-0 focus:outline-none"
            >
              {cell}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ from, to, onChange, boxed = false }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  // Anchor date: the left panel shows the month of the current `from` (for
  // existing selections) or this month (for a fresh pick). The user navigates
  // with the calendar header chevrons; this is a view offset, not a filter.
  const anchorInit = fromISO(from) || fromISO(to) || new Date();
  const [viewAnchor, setViewAnchor] = useState(new Date(anchorInit.getFullYear(), anchorInit.getMonth(), 1));
  const [draftFrom, setDraftFrom] = useState(from || '');
  const [draftTo, setDraftTo] = useState(to || '');
  const [hoverDate, setHoverDate] = useState('');

  const draftLabel = useMemo(() => formatLabel(draftFrom, draftTo), [draftFrom, draftTo]);
  const canApply = draftFrom !== '' || draftTo !== '';
  const dirty = draftFrom !== (from || '') || draftTo !== (to || '');

  const openPicker = () => {
    // Sync the draft with whatever is currently applied, then frame the
    // calendar on it so the user lands where they left off.
    setDraftFrom(from || '');
    setDraftTo(to || '');
    const anchor = fromISO(from) || fromISO(to) || new Date();
    setViewAnchor(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    setHoverDate('');
    setOpen(true);
  };
  const close = () => setOpen(false);

  const popoverStyle = usePopoverPosition(triggerRef, open, [open]);
  const vw = useViewportWidth();
  // Narrow viewports get the mobile-style bottom sheet; desktop keeps a
  // compact anchored popover (single month, ~300px wide).
  const isMobileSheet = vw < 1280;

  // Close on outside tap / Escape, but ignore clicks inside either element.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const handlePick = (day) => {
    // First click -> draft single day; second click completes the range.
    // Clicking the same day twice = still a single-day pick (no-op to mode).
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(day);
      setDraftTo(day);
    } else {
      const [lo, hi] = day >= draftFrom ? [draftFrom, day] : [day, draftFrom];
      setDraftFrom(lo);
      setDraftTo(hi);
    }
    setHoverDate('');
  };

  const handleQuick = (q) => {
    const f = q.from(); const t = q.to();
    setDraftFrom(f);
    setDraftTo(t);
    setHoverDate('');
    // Jump the visible calendar to the range that was just applied so the
    // highlight reads immediately instead of keeping the user on whatever
    // month the trigger happened to land on.
    const anchor = fromISO(f) || fromISO(t) || new Date();
    setViewAnchor(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  };

  const shiftMonths = (delta) => {
    setViewAnchor(v => { const d = new Date(v); d.setMonth(d.getMonth() + delta); return d; });
  };

  const monthTitle = (d) => `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  // Compact preset row shared by both layouts — one wrap line, no sidebar.
  const presetsRow = (
    <div className="flex flex-wrap gap-1.5 px-3 pt-3">
      {QUICK_RANGES.map(q => {
        const qf = q.from(); const qt = q.to();
        const active = draftFrom === qf && draftTo === qt;
        return (
          <button
            key={q.label}
            type="button"
            onClick={() => handleQuick(q)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
              active ? 'bg-[#bf4a53] text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-800 border border-gray-200/60'
            }`}
          >
            {q.label}
          </button>
        );
      })}
    </div>
  );

  // Single month — the old dual-month desktop grid doubled the popover width
  // for little benefit (chevrons + preset jumps cover navigation).
  const calendarCore = (
    <div className="px-3 pt-2 pb-1 mx-auto w-fit">
      <div className="flex items-center justify-between mb-1">
        <button type="button" onClick={() => shiftMonths(-1)} aria-label="Previous month" className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500"><ChevronLeft size={16} /></button>
        <div className="text-xs font-bold text-gray-900">{monthTitle(viewAnchor)}</div>
        <button type="button" onClick={() => shiftMonths(1)} aria-label="Next month" className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500"><ChevronRight size={16} /></button>
      </div>
      <MonthGrid monthDate={viewAnchor} rangeStart={draftFrom} rangeEnd={draftTo} hoverDate={hoverDate} onSelect={handlePick} onHover={setHoverDate} />
    </div>
  );

  const clearDraft = () => {
    setDraftFrom('');
    setDraftTo('');
    const anchor = new Date();
    setViewAnchor(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  };

  const footer = (
    <div className="flex items-center justify-between gap-2 border-t border-gray-100 mt-2 px-3 py-2.5">
      <span className="text-xs font-semibold text-gray-700 truncate">{draftLabel}</span>
      <div className="flex items-center gap-1 shrink-0">
        {(draftFrom || draftTo) && (
          <button type="button" onClick={clearDraft} className="px-2.5 py-1.5 text-xs font-bold text-gray-400 hover:text-[#bf4a53] rounded-full transition-colors">Clear</button>
        )}
        <button type="button" onClick={() => { onChange({ from: draftFrom, to: draftTo }); close(); }} disabled={!canApply && !dirty}
          className="px-4 py-1.5 text-xs font-bold text-white bg-gray-900 rounded-full hover:bg-black disabled:opacity-40">
          Apply
        </button>
      </div>
    </div>
  );

  const popover = open ? createPortal(
    isMobileSheet ? (
      <>
        {/* Backdrop dims the page and closes on tap. */}
        <div className="fixed inset-0 bg-gray-900/40 z-[59]" onClick={close} />
        <div
          ref={popoverRef}
          className="fixed bottom-0 inset-x-0 z-[60] bg-white rounded-t-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200 max-h-[85dvh] flex flex-col"
        >
          {/* drag handle */}
          <div className="flex justify-center pt-2.5 pb-1 shrink-0">
            <div className="w-10 h-1 bg-gray-200 rounded-full" />
          </div>
          {presetsRow}
          {/* Calendar + footer scroll together if the sheet is short on height. */}
          <div className="overflow-y-auto flex-1">
            {calendarCore}
            {footer}
          </div>
        </div>
      </>
    ) : (
      <div ref={popoverRef}
        style={popoverStyle}
        className="bg-white rounded-2xl border border-gray-200/80 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 w-[300px]"
      >
        {presetsRow}
        {calendarCore}
        {footer}
      </div>
    ),
    document.body
  ) : null;

  const label = formatLabel(from, to);
  const hasValue = Boolean(from || to);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => (open ? close() : openPicker())}
        className={boxed
          ? `flex-1 min-w-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer border ${
              hasValue
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-gray-50 border-gray-200/60 text-gray-700 hover:border-gray-400'
            }`
          : `inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-bold transition-all shadow-sm border ${
              hasValue
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-800'
            }`}
      >
        <Calendar size={13} className="shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {popover}
    </>
  );
}

export { formatLabel as formatDateRangeLabel };
