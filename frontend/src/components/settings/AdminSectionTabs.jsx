import { Building2, Bell, ShieldCheck, Users, Percent, HelpCircle, Database } from 'lucide-react';

// Admin Settings is split into tabs so the operations area stays navigable
// instead of one long wall of cards.
export const ADMIN_SECTIONS = [
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'integrations', label: 'Integrations', icon: ShieldCheck },
  { id: 'promotions', label: 'Promotions', icon: Percent },
  { id: 'data', label: 'Data & Backups', icon: Database },
  { id: 'team', label: 'Team & Security', icon: Users },
  { id: 'help', label: 'Help Guide', icon: HelpCircle },
];

export default function AdminSectionTabs({ active, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {ADMIN_SECTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => onChange(id)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${
            active === id
              ? 'bg-gray-900 text-white shadow-md'
              : 'bg-white border border-gray-200/80 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
          }`}>
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}