import { ChevronLeft, ChevronRight, SlidersHorizontal, Calendar } from 'lucide-react';

export default function StaffRecordsView({ transactions, onNavigate }) {
  const recent = transactions.slice(0, 4);

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat'];
  const daysInMonth = 31;
  const startDay = 5; // May 1, 2026 is a Friday

  const cells = [];
  for (let i = 0; i < startDay; i++) {
    cells.push(<div key={`e-${i}`} />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      <div key={d} className="flex items-center justify-center">
        <span className={`flex items-center justify-center w-8 h-8 text-sm font-semibold ${
          d === 6
            ? 'bg-gray-900 text-white rounded-full'
            : 'text-gray-700'
        }`}>
          {d}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-lg mx-auto">
      <div>
        <h2 className="text-xl font-bold text-gray-900 tracking-tight">Records</h2>
        <p className="text-sm text-gray-500 mt-0.5">Digital logbook of all rental transactions.</p>
      </div>

      {/* Recent Activity Card */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-900">Recent Activity</h3>
          <button onClick={() => onNavigate('History')}
            className="text-xs font-bold text-[#bf4a53] hover:underline">View All</button>
        </div>

        {/* Filter pill */}
        <div className="flex justify-center mb-5 px-1">
          <div className="inline-flex flex-wrap items-center justify-center gap-2 bg-gray-100/80 rounded-2xl px-3 py-2 max-w-full">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-[11px] font-semibold text-gray-600">Reserved</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 ml-1.5" />
            <span className="text-[11px] font-semibold text-gray-600">Active</span>
            <span className="w-2 h-2 rounded-full bg-gray-400 ml-1.5" />
            <span className="text-[11px] font-semibold text-gray-600">Returned</span>
            <span className="ml-2 text-gray-400"><SlidersHorizontal size={13} /></span>
          </div>
        </div>

        {/* List items */}
        <div className="space-y-0">
          {recent.map((tx, i) => (
            <div key={tx.id}>
              {i > 0 && <div className="border-t border-gray-100/80 mx-1" />}
              <div className="flex items-center gap-3 py-3 px-1">
                <div className="w-9 h-9 rounded-full bg-gray-100 shrink-0 flex items-center justify-center text-gray-400">
                  <span className="text-xs font-bold text-gray-500">
                    {(tx.customer || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{tx.customer || 'Unknown'}</p>
                  <p className="text-xs text-gray-500 truncate">{tx.item || '—'}</p>
                </div>
                <span className="shrink-0 px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold">Reservation</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar Card */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-700" />
            <h3 className="text-sm font-bold text-gray-900">May 2026</h3>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <ChevronLeft size={16} />
            </button>
            <button className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {dayLabels.map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-y-1">
          {cells}
        </div>
      </div>
    </div>
  );
}
