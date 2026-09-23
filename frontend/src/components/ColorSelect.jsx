import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

// Shared multi-select Colors dropdown — used by ItemForm (staff tagging) and
// the catalog advanced filter. Collapses the 22+ color list into one row:
// closed it shows the selection summary, open it offers search + check rows.
export default function ColorSelect({
  options = [],
  selected = [],
  onToggle,
  onClear,
  counts = null,
  label = 'Colors',
  placeholder = 'Search colors…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  const q = query.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const summary = selected.length === 0
    ? `All ${label.toLowerCase()}`
    : selected.length <= 2
      ? selected.join(', ')
      : `${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-2xl border text-[13px] font-bold transition-all focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15 ${
          selected.length > 0
            ? 'bg-[#bf4a53]/5 border-[#bf4a53]/40 text-gray-900'
            : 'bg-white border-gray-200/80 text-gray-500 hover:border-gray-400'
        }`}
      >
        <span className="truncate">
          {label}: <span className={selected.length > 0 ? 'text-[#bf4a53]' : 'text-gray-400'}>{summary}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 right-0 bg-white rounded-2xl border border-gray-100 shadow-xl shadow-gray-950/10 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200/60 rounded-xl text-[13px] font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#bf4a53] transition-colors"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5">
            {visible.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">No colors match “{query}”</p>
            )}
            {visible.map((color) => {
              const active = selected.some((c) => c.toLowerCase() === color.toLowerCase());
              const count = counts ? counts[color] ?? counts[color.toLowerCase()] : null;
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => onToggle(color)}
                  aria-pressed={active}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-[13px] font-semibold transition-colors ${
                    active ? 'bg-[#bf4a53]/5 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center shrink-0 transition-all ${
                    active ? 'bg-[#bf4a53] border-[#bf4a53] text-white' : 'bg-white border-gray-300 text-transparent'
                  }`}>
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span className="flex-1 truncate">{color}</span>
                  {count !== null && count !== undefined && (
                    <span className={`min-w-[20px] h-5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center tabular-nums ${active ? 'bg-[#bf4a53]/15 text-[#bf4a53]' : 'bg-gray-100 text-gray-400'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {selected.length > 0 && onClear && (
            <div className="p-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => { onClear(); }}
                className="w-full py-1.5 text-[11px] font-bold text-[#bf4a53] hover:bg-[#bf4a53]/5 rounded-xl transition-colors"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
