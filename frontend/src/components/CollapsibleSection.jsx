import { useState, useEffect, useId } from 'react';
import { ChevronDown } from 'lucide-react';

// Collapsible booking-flow section (NOT persisted — every new booking opens
// expanded, unlike Settings cards). The header carries a live summary (e.g.
// "Oct 10 → Oct 12") so the collapsed state still answers "what did I pick".
// Auto-expands when `hasError` turns true so validation messages are never
// hidden inside a closed section.
export default function CollapsibleSection({
  icon: Icon,
  title,
  required = false,
  summary,
  hasError = false,
  defaultOpen = true,
  children,
}) {
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (hasError) setOpen(true);
  }, [hasError]);

  return (
    <div className="bg-white border border-gray-100/80 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-center gap-2.5 px-4 sm:px-5 py-3.5 min-h-[60px] text-left hover:bg-gray-50/60 active:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/50"
      >
        <span className="w-9 h-9 rounded-xl bg-[#bf4a53]/10 text-[#bf4a53] flex items-center justify-center shrink-0">
          {Icon && <Icon size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-gray-900 leading-tight">
            {title}
            {required && (
              <span aria-hidden="true" className="text-[#bf4a53]"> *</span>
            )}
          </span>
          {summary && (
            <span className={`block text-[11px] font-semibold mt-0.5 truncate ${hasError ? 'text-red-500' : 'text-gray-400'}`}>
              {summary}
            </span>
          )}
        </span>
        {hasError && (
          <span aria-label="Needs attention" className="shrink-0 w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        )}
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={`shrink-0 text-gray-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        id={bodyId}
        role="region"
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          open ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-1 space-y-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
