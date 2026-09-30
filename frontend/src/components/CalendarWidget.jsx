import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toLocalYmd } from '../utils/format';

export default function CalendarWidget({ selectedDate, onSelect, bookedDates = [], label }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [viewDate, setViewDate] = useState(selectedDate ? new Date(selectedDate) : new Date());
  const [isMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = new Date(year, month, 1).getDay();
  const startDayOffset = isMobile ? (startDay === 0 ? 6 : startDay - 1) : startDay;
  const dayHeaders = isMobile
    ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
    : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const monthName = viewDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const isBooked = (day) => {
    const d = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return bookedDates.includes(d);
  };

  const isPast = (day) => {
    const d = new Date(year, month, day);
    return d < today;
  };

  const isToday = (day) => {
    const d = new Date(year, month, day);
    return d.getTime() === today.getTime();
  };

  const isSelected = (day) => {
    if (!selectedDate) return false;
    const s = new Date(selectedDate);
    return s.getFullYear() === year && s.getMonth() === month && s.getDate() === day;
  };

  const handleDayClick = (day) => {
    if (isPast(day) || isBooked(day)) return;
    onSelect(toLocalYmd(new Date(year, month, day)));
  };

  const handleToday = () => {
    onSelect(toLocalYmd(today));
    setViewDate(new Date());
  };

  const cells = [];
  for (let i = 0; i < startDayOffset; i++) {
    cells.push(<div key={`empty-${i}`} />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const booked = isBooked(d);
    const past = isPast(d);
    const todayFlag = isToday(d);
    const selected = isSelected(d);
    cells.push(
      <button key={d} disabled={past || booked} onClick={() => handleDayClick(d)}
        className={`relative flex items-center justify-center w-9 h-9 text-sm font-medium rounded-full transition-all ${
          selected ? 'bg-[#bf4a53] text-white shadow-sm' :
          todayFlag && !selected ? 'ring-2 ring-[#bf4a53]/40 text-[#bf4a53] font-bold' :
          past || booked ? 'text-gray-300 line-through cursor-not-allowed' :
          'text-gray-700 hover:bg-gray-100'
        }`}>
        {d}
        {booked && !selected && (
          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[#bf4a53]" />
        )}
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 w-full max-w-xs">
      {label && <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3">{label}</p>}

      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-bold text-gray-900">{monthName}</span>
        <button onClick={nextMonth} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0 mb-1">
        {dayHeaders.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0">
        {cells}
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <span className="text-xs text-gray-500 font-medium">
          {selectedDate ? new Date(selectedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Select a date'}
        </span>
        <button onClick={handleToday}
          className="px-3 py-1 text-[11px] font-bold text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
          Today
        </button>
      </div>
    </div>
  );
}
