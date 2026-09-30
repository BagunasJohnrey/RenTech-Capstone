import { useState } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const inRange = (dateStr, start, end) => start && end && dateStr >= start && dateStr <= end;

/**
 * Custom availability calendar for booking. Marks already-booked dates as
 * unavailable (red) and lets staff pick a pickup date then an event date.
 * Booked ranges come from the item's active/overdue transactions.
 */
export default function BookingCalendar({ pickup, event, onChange, bookedRanges = [], minDate, disabled = false, returnDays = 1 }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const min = minDate || ymd(today);
  const [view, setView] = useState(() => startOfMonth(pickup ? new Date(pickup) : today));
  const [warn, setWarn] = useState('');

  const isBooked = (ds) => bookedRanges.some((r) => inRange(ds, r.start, r.end));
  const isPast = (ds) => ds < min;

  // Does the currently selected window overlap any booking?
  const selectedOverlaps = !!(
    pickup &&
    event &&
    bookedRanges.some(
      (r) => inRange(r.start, pickup, event) || inRange(r.end, pickup, event) || inRange(pickup, r.start, r.end)
    )
  );

  const handleDayClick = (ds) => {
    if (disabled) return;
    if (isPast(ds) || isBooked(ds)) {
      setWarn(isBooked(ds) ? 'That date is already booked for this item.' : 'Cannot select a past date.');
      return;
    }
    setWarn('');
    // First click (or restart) sets pickup and clears event.
    if (!pickup || (pickup && event)) {
      onChange(ds, '');
      return;
    }
    // Second click sets the event date.
    if (ds < pickup) {
      setWarn('Event date must be on or after pickup.');
      return;
    }
    onChange(pickup, ds);
  };

  const firstDay = view.getDay();
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));

  const canPrev = startOfMonth(view) > startOfMonth(today);

  const fmt = (ds) =>
    ds ? new Date(ds).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—';

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 select-none">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => setView(addMonths(view, -1))}
          className="p-1.5 rounded-full hover:bg-gray-100 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <p className="font-bold text-sm text-gray-900">
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </p>
        <button
          type="button"
          onClick={() => setView(addMonths(view, 1))}
          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] font-bold text-gray-400">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const ds = ymd(date);
          const past = isPast(ds);
          const booked = isBooked(ds);
          const isPickup = ds === pickup;
          const isEvent = ds === event;
          const inSel = pickup && event && ds > pickup && ds < event;
          const dayDisabled = past || booked || disabled;

          let cls = 'aspect-square rounded-lg text-[11px] flex items-center justify-center font-medium transition-colors ';
          if (booked) cls += 'bg-red-50 text-red-400 line-through cursor-not-allowed';
          else if (past) cls += 'text-gray-300 cursor-not-allowed';
          else if (isPickup) cls += 'bg-[#bf4a53] text-white';
          else if (isEvent) cls += 'bg-emerald-500 text-white';
          else if (inSel) cls += 'bg-red-50 text-[#bf4a53]';
          else cls += 'text-gray-700 hover:bg-gray-100 cursor-pointer';

          return (
            <button type="button" key={i} disabled={dayDisabled} onClick={() => handleDayClick(ds)} className={cls}>
              {date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 mt-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-[#bf4a53]" /> Pickup
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-emerald-500" /> Event
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-50 border border-red-200" /> Booked
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-100" /> In range
        </span>
      </div>

      <p className="mt-2 text-[10px] text-gray-400 text-center">
        {!pickup
          ? 'Tap a date to set the pickup date.'
          : !event
          ? 'Now tap the event date.'
          : returnDays === 1
          ? 'Return is due the day after the event.'
          : `Return is due ${returnDays} days after the event.`}
      </p>

      {warn && (
        <p className="text-[11px] text-red-500 font-medium mt-2 flex items-center gap-1">
          <AlertCircle size={12} />
          {warn}
        </p>
      )}
      {selectedOverlaps && (
        <p className="text-[11px] text-red-500 font-medium mt-2 flex items-center gap-1">
          <AlertCircle size={12} />
          Selected range overlaps an existing booking for this item.
        </p>
      )}

      {(pickup || event) && (
        <div className="mt-2 text-[11px] text-gray-600 flex flex-wrap justify-center gap-x-3">
          {pickup && (
            <span>
              Pickup: <b>{fmt(pickup)}</b>
            </span>
          )}
          {event && (
            <>
              <span>
                Event: <b>{fmt(event)}</b>
              </span>
              <span>
                Return:{' '}
                <b>
                  {fmt(
                    (() => {
                      const r = new Date(event);
                      r.setDate(r.getDate() + returnDays);
                      return ymd(r);
                    })()
                  )}
                </b>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
