import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// Card-style accordion shared by the staff + admin/customer help guides:
// questions sit in a 2-column grid on desktop; the open answer spans the
// full row so long answers read edge to edge.
export default function HelpAccordion({ items, renderAnswer }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            key={i}
            className={`rounded-2xl border transition-colors overflow-hidden ${
              isOpen
                ? 'border-[#bf4a53]/30 bg-red-50/40 md:col-span-2'
                : 'bg-[#fafafa] border-gray-100 hover:border-gray-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 p-3.5 sm:p-4 min-h-[52px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/50"
            >
              <span className="flex-1 min-w-0 font-bold text-sm text-gray-900">{item.q}</span>
              <ChevronDown
                size={17}
                aria-hidden="true"
                className={`shrink-0 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {isOpen && (
              <div className="px-3.5 sm:px-4 pb-4">
                {renderAnswer(item)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
