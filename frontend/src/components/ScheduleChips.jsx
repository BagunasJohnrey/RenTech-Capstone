// Pickup / Event / Return summary chips shared by the customer booking flow
// and the staff walk-in flow. Rendered once a pickup day exists; the return
// date is derived from the event day + the store's return-after-event rule.
const short = (ds) => {
  if (!ds) return '—';
  const d = new Date(`${ds}T00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const addDays = (ds, n) => {
  const d = new Date(`${ds}T00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const shortDate = (ds) => short(ds);

export default function ScheduleChips({ pickup, event, returnDays = 1, vertical = false }) {
  if (!pickup && !event) return null;
  const due = event ? addDays(event, returnDays) : null;
  const chips = [
    { label: 'Pickup', value: short(pickup), dot: 'bg-[#bf4a53]', text: 'text-[#bf4a53]' },
    { label: 'Event', value: short(event), dot: 'bg-emerald-500', text: 'text-emerald-600' },
    { label: 'Return', value: due || 'Auto', dot: 'bg-amber-500', text: 'text-amber-700' },
  ];
  if (vertical) {
    return (
      <div className="space-y-2" aria-label="Selected rental dates">
        {chips.map(({ label, value, dot, text }) => (
          <div key={label} className="flex items-center gap-2 p-2.5 bg-[#fafafa] rounded-2xl border border-gray-100 min-w-0">
            <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
            <p className={`text-xs font-extrabold truncate ml-auto ${text}`}>{value}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2" aria-label="Selected rental dates">
      {chips.map(({ label, value, dot, text }) => (
        <div key={label} className="flex items-center gap-2 p-2.5 sm:p-3 bg-[#fafafa] rounded-2xl border border-gray-100 min-w-0">
          <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none">{label}</p>
            <p className={`text-xs sm:text-sm font-extrabold truncate mt-1 ${text}`}>{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
