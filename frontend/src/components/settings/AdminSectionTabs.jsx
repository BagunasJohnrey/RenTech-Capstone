import { useEffect, useRef } from 'react';
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
  // Keep the selected tab visible when the row scrolls (phones, or a deep
  // link straight to a later tab like ?tab=audit).
  const activeRef = useRef(null);
  useEffect(() => {
    // Horizontal only: scrollIntoView would also jump the page vertically.
    const el = activeRef.current;
    const row = el?.closest('[data-tab-scroller]');
    if (!el || !row) return;
    const left = el.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft) row.scrollLeft = left - 8;
    else if (left + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + el.offsetWidth - row.clientWidth + 8;
  }, [active]);
  return (
    // Inner row is w-max + mx-auto: centered when the tabs fit, scrollable
    // (never clipped on the left) when they don't.
    <div data-tab-scroller className="overflow-x-auto pb-1 -mx-1 px-1">
    <div role="tablist" aria-label="Settings sections" className="flex gap-2 w-max mx-auto">
      {ADMIN_SECTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} ref={active === id ? activeRef : undefined} type="button" role="tab" aria-selected={active === id} onClick={() => onChange(id)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${
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
  );
}