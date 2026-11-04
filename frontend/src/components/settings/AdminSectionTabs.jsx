import { useEffect, useRef, useState, useCallback } from 'react';
import { Building2, Bell, ShieldCheck, Users, HelpCircle, Database, History } from 'lucide-react';

// Admin Settings is split into tabs so the operations area stays navigable
// instead of one long wall of cards.
export const ADMIN_SECTIONS = [
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'integrations', label: 'Integrations', icon: ShieldCheck },
  { id: 'data', label: 'Data & Backups', icon: Database },
  { id: 'team', label: 'Team & Security', icon: Users },
  { id: 'audit', label: 'Audit Trail', icon: History },
  { id: 'help', label: 'Help Guide', icon: HelpCircle },
];

export default function AdminSectionTabs({ active, onChange }) {
  const scrollerRef = useRef(null);
  const activeRef = useRef(null);
  // Edge fades only while there is more to scroll that way, so phones get a
  // visible "swipe for more" cue and desktop (tabs fit) shows none.
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const row = scrollerRef.current;
    if (!row) return;
    const max = row.scrollWidth - row.clientWidth;
    setEdges({ left: row.scrollLeft > 4, right: row.scrollLeft < max - 4 });
  }, []);

  // Keep the selected tab visible when the row scrolls (phones, or a deep
  // link straight to a later tab like ?tab=audit). Horizontal only:
  // scrollIntoView would also jump the page vertically.
  useEffect(() => {
    const el = activeRef.current;
    const row = scrollerRef.current;
    if (!el || !row) return;
    const left = el.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft) row.scrollLeft = left - 16;
    else if (left + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + el.offsetWidth - row.clientWidth + 16;
    measure();
  }, [active, measure]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return (
    <div className="relative -mx-5 sm:mx-0">
      {/* Inner row is w-max + mx-auto: centered when the tabs fit, scrollable
          (never clipped on the left) when they don't. Phones bleed to the
          screen edge so the row reads as swipeable. */}
      <div ref={scrollerRef} onScroll={measure} data-tab-scroller
        className="overflow-x-auto pb-1 px-5 sm:px-1 sm:-mx-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden scroll-smooth">
        <div role="tablist" aria-label="Settings sections" className="flex gap-1.5 sm:gap-2 w-max mx-auto">
          {ADMIN_SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} ref={active === id ? activeRef : undefined} type="button" role="tab" aria-selected={active === id} onClick={() => onChange(id)}
              className={`flex items-center gap-1.5 sm:gap-2 px-3.5 sm:px-4 min-h-[40px] sm:min-h-0 sm:py-2.5 rounded-full text-[13px] sm:text-sm font-bold whitespace-nowrap transition-colors ${
                active === id
                  ? 'bg-gray-900 text-white shadow-md'
                  : 'bg-white border border-gray-200/80 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }`}>
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <span aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[#fcfcfd] to-transparent transition-opacity ${edges.left ? 'opacity-100' : 'opacity-0'}`} />
      <span aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#fcfcfd] to-transparent transition-opacity ${edges.right ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  );
}
