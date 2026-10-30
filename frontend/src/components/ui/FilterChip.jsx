// Toggleable filter pill with an optional count badge. Modeled on the
// Catalog status chips; `aria-pressed` tells screen readers which is active.
export default function FilterChip({ active, count, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-full text-xs font-bold border whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 ${
        active
          ? 'bg-gray-900 text-white border-gray-900'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900'
      } ${className}`}
    >
      {children}
      {count != null && (
        <span
          className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold ${
            active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
