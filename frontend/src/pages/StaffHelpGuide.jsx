import { useState } from 'react';
import {
  ChevronDown, ChevronUp, ClipboardList, Palette, Package, Ticket,
  LayoutDashboard, HelpCircle, Play,
} from 'lucide-react';
import SettingsCard from '../components/settings/SettingsCard';
import { itemPill, txPill } from '../utils/statusColors';
import {
  staffFaqs, inventoryActions, statusReference, transactionStatuses,
  alterationStatuses, colorLegend, dashboardTerms,
} from './HelpGuide';

// Staff-only workflows: the exact button flows for front-desk jobs. Each
// answer mirrors the current UI so this page never describes a stale flow.
const staffWorkflows = [
  {
    q: 'New walk-in rental (the full flow)',
    steps: [
      'Dashboard → "+ New Rental", or Catalog → "Book for Customer" on an item card.',
      'Step 1 — pick the item: search, filter by category, scroll (or "Show more") to see everything, then tap to select and Continue.',
      'Step 2 — customer details: name, 11-digit contact, address, pickup/event dates on the calendar, size (or custom measurements), optional downpayment.',
      'Step 3 — review: check every row, set a discount with the slider if the customer gets one (see discounts below), then "Confirm & Process".',
      'Receipt — shows the booking code + QR for pickup. Print it if the customer wants a copy.',
    ],
  },
  {
    q: 'Process a return',
    steps: [
      'Find the Active/Overdue rental (Dashboard priority list or Records) → "Process Return".',
      'Good condition → Confirm: the item goes to the Cleaning queue.',
      'Damaged → pick a reason (required), optionally type a custom damage fee (blank = the store default), and Confirm: the item goes straight Out of Service.',
      'Add a condition photo and notes if useful, then Confirm. The button locks while it saves so a double-tap files it once.',
    ],
  },
  {
    q: 'Release an item for pickup',
    steps: [
      'Open the Reserved booking → "Release".',
      'Capture the condition photo, flag alteration if the piece needs fitting work, and confirm — the rental goes Active.',
    ],
  },
  {
    q: 'Give a discount (admin PIN at confirmation)',
    steps: [
      'On the review step, move the discount slider to the agreed % — no PIN yet.',
      'Press "Confirm & Process": the admin enters their 4-digit PIN approving that exact amount (shown in pesos on the item).',
      'Approval LOCKS the discount — the slider greys out. To change it, Remove it, re-pick, and get a fresh approval.',
      'Press Confirm again to finish the booking.',
    ],
  },
  {
    q: 'Send a custom overdue SMS',
    steps: [
      'Records (or Tasks) → overdue row → "Send SMS".',
      'The message comes pre-filled — edit it freely for that customer, then Send. What you see is what sends.',
      'Manual sends always go through, even if the customer turned reminders off.',
    ],
  },
  {
    q: 'Clear the Cleaning queue',
    steps: [
      'Open the Cleaning queue, tick several items, and "Mark selected as cleaned" — they flip to Available as a batch.',
    ],
  },
];

const extraStaffFaqs = [
  { q: 'The item list only shows a few items — where are the rest?', a: 'The list loads 6 at a time. Scroll inside the list to load more, or tap the "Show more" button under it.' },
  { q: 'Why is the discount slider greyed out?', a: 'An admin already approved that exact discount, which locks it. To change the amount, tap Remove, pick the new %, and get a fresh PIN approval.' },
  { q: 'A return shows "Alteration Pending" instead of its status — is that an error?', a: 'No. When a fitting flag is set, its badge replaces the booking status so there is only one badge per row. The booking itself is unchanged.' },
];

function Accordion({ items, renderAnswer }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="divide-y divide-gray-100/60">
      {items.map((item, i) => (
        <div key={i}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between gap-3 px-1 py-3 text-left hover:bg-gray-50/50 transition-colors"
          >
            <span className="font-semibold text-sm text-gray-900">{item.q}</span>
            {open === i ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
          </button>
          {open === i && (
            <div className="px-1 pb-4">
              {renderAnswer(item)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Staff-only Help Guide, styled as native Settings cards so it sits naturally
// in Profile Settings: compact hero + one card per topic. Status references
// are imported from the shared guide so the two can never disagree.
// No Terms section — that legal text is customer/admin-facing.
export default function StaffHelpGuide({ onStartTutorial }) {
  return (
    <div className="space-y-4">
      {/* Compact hero */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-5 md:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="flex flex-wrap items-center justify-between gap-3 relative z-10">
          <div className="flex items-center gap-2.5">
            <HelpCircle className="text-[#bf4a53]" size={22} />
            <div>
              <h2 className="text-xl font-bold tracking-tight">Staff Help Guide</h2>
              <p className="text-xs text-gray-400 font-medium mt-0.5">Your flows, your buttons, every status badge.</p>
            </div>
          </div>
          {onStartTutorial && (
            <button
              onClick={onStartTutorial}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#bf4a53] hover:bg-red-600 text-white text-xs font-bold transition-colors shadow-lg shadow-red-900/40"
            >
              <Play size={12} /> Guided tour
            </button>
          )}
        </div>
      </div>

      {/* Workflows */}
      <SettingsCard
        icon={ClipboardList}
        iconClass="bg-red-50 text-[#bf4a53]"
        title="Front-desk workflows"
        desc="Tap a job to see every tap, in order"
      >
        <Accordion
          items={staffWorkflows}
          renderAnswer={(w) => (
            <ol className="space-y-2">
              {w.steps.map((s, j) => (
                <li key={j} className="flex gap-2.5 text-sm text-gray-600 leading-relaxed">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] text-[11px] font-bold flex items-center justify-center mt-0.5">{j + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
        />
      </SettingsCard>

      {/* Status colors */}
      <SettingsCard
        icon={Palette}
        iconClass="bg-violet-50 text-violet-600"
        title="Status colors"
        desc="One color = one meaning, everywhere in the app"
      >
        <div className="divide-y divide-gray-100/60">
          {colorLegend.map(({ key, cls, label, desc }) => (
            <div key={key} className="flex items-start gap-3 py-3">
              <span className={`mt-1 shrink-0 w-2.5 h-2.5 rounded-full shadow-sm ${cls}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">{label}</p>
                <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>

      {/* Catalog buttons */}
      <SettingsCard
        icon={Package}
        iconClass="bg-blue-50 text-blue-600"
        title="Catalog buttons"
        desc="What the buttons on an item card do, status by status"
      >
        <div className="divide-y divide-gray-100/60">
          {inventoryActions.map(({ status, PillIcon, pillCls, btnLabel, desc }) => {
            const meta = itemPill(status);
            const StatusIcon = meta.icon;
            return (
              <div key={status} className="flex items-start gap-3 py-3">
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${meta.bg} ${meta.text} ${meta.border}`}>
                  <StatusIcon size={10} />
                  {meta.label}
                </span>
                <div className="flex-1 min-w-0">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold mb-1.5 ${pillCls}`}>
                    <PillIcon size={11} />
                    {btnLabel}
                  </span>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            );
          })}
          {statusReference.map(({ status, desc }) => {
            const meta = itemPill(status);
            const StatusIcon = meta.icon;
            return (
              <div key={status} className="flex items-start gap-3 py-3">
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${meta.bg} ${meta.text} ${meta.border}`}>
                  <StatusIcon size={10} />
                  {meta.label}
                </span>
                <p className="text-xs text-gray-500 leading-relaxed flex-1">{desc}</p>
              </div>
            );
          })}
        </div>
      </SettingsCard>

      {/* Rental statuses + alteration flags */}
      <SettingsCard
        icon={Ticket}
        iconClass="bg-indigo-50 text-indigo-600"
        title="Rental statuses"
        desc="What each transaction badge means — and whether it needs you"
      >
        <div className="divide-y divide-gray-100/60">
          {transactionStatuses.map(({ key, Icon, desc }) => {
            const meta = txPill(key);
            return (
              <div key={key} className="flex items-start gap-3 py-3">
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${meta.bg} ${meta.text} ${meta.border}`}>
                  <Icon size={10} />
                  {key}
                </span>
                <p className="text-xs text-gray-500 leading-relaxed flex-1">{desc}</p>
              </div>
            );
          })}
          {alterationStatuses.map(({ key, cls, desc }) => (
            <div key={key} className="flex items-start gap-3 py-3">
              <span className={`shrink-0 inline-flex items-center px-2 py-1 rounded-full border text-[10px] font-bold ${cls}`}>
                {key}
              </span>
              <p className="text-xs text-gray-500 leading-relaxed flex-1">{desc}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">When an alteration flag is set, its badge replaces the booking status — only one badge per row.</p>
      </SettingsCard>

      {/* Dashboard labels */}
      <SettingsCard
        icon={LayoutDashboard}
        iconClass="bg-emerald-50 text-emerald-600"
        title="Dashboard labels"
        desc="Everyday terms on the staff dashboard"
      >
        <div className="divide-y divide-gray-100/60">
          {dashboardTerms.map(({ Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3 py-3">
              <span className="shrink-0 w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500">
                <Icon size={16} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">{title}</p>
                <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>

      {/* FAQ */}
      <SettingsCard
        icon={HelpCircle}
        iconClass="bg-amber-50 text-amber-600"
        title="Frequently Asked Questions"
      >
        <Accordion
          items={[...staffFaqs, ...extraStaffFaqs]}
          renderAnswer={(f) => <p className="text-sm text-gray-600 leading-relaxed">{f.a}</p>}
        />
      </SettingsCard>
    </div>
  );
}
