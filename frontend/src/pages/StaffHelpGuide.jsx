import {
  ClipboardList, Palette, Package, Ticket,
  LayoutDashboard, HelpCircle, Play,
} from 'lucide-react';
import CollapsibleCard from '../components/settings/CollapsibleCard';
import HelpAccordion from '../components/HelpAccordion';
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
      'Find the Active/Overdue rental (Dashboard priority list or Records). Returns are accepted only when fully paid — if a balance shows, tap "Record Payment" first (Cash tab or Online via PayMongo/Maya QR).',
      'Then tap "Process Return". Good condition → Confirm: the item goes to the Cleaning queue.',
      'Damaged → pick a reason (required), optionally type a custom damage fee (blank = the store default), and Confirm: the item goes straight Out of Service. A damage fee may leave a new balance, which stays payable on the Returned record.',
      'Add a condition photo and notes if useful, then Confirm. The button locks while it saves so a double-tap files it once.',
    ],
  },
  {
    q: 'Release an item for pickup',
    steps: [
      'Open the Reserved booking → "Release". Full payment is required first — the sheet shows Cash / Online tabs when a balance is due.',
      'Cash: amount is locked to the full balance — one tap collects it and releases. Online: generate the PayMongo checkout or Maya QR, let the customer pay, and the sheet unlocks once the balance hits ₱0.',
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

const Accordion = HelpAccordion;

const countBadge = (n, singular) => (
  <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] text-[11px] font-bold tabular-nums">
    {n} {singular}{n === 1 ? '' : 's'}
  </span>
);

// Staff-only Help Guide: collapsible header-band cards (same language as
// Settings) so a long guide stays scannable — workflows open by default,
// reference sections collapse with count badges. Status data is imported
// from the shared guide so the two can never disagree.
// No Terms section — that legal text is customer/admin-facing.
export default function StaffHelpGuide({ onStartTutorial }) {
  const allFaqs = [...staffFaqs, ...extraStaffFaqs];

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-5 md:p-8 text-white shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="flex flex-wrap items-center justify-between gap-3 relative z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <HelpCircle className="text-[#bf4a53] shrink-0" size={24} />
            <div className="min-w-0">
              <h2 className="text-xl md:text-2xl font-bold tracking-tight">Staff Help Guide</h2>
              <p className="text-xs md:text-sm text-gray-400 font-medium mt-0.5">Your flows, your buttons, every status badge.</p>
            </div>
          </div>
          {onStartTutorial && (
            <button
              onClick={onStartTutorial}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-full bg-[#bf4a53] hover:bg-red-600 text-white text-xs font-bold transition-colors shadow-lg shadow-red-900/40"
            >
              <Play size={12} /> Guided tour
            </button>
          )}
        </div>
      </div>

      {/* Workflows */}
      <CollapsibleCard
        icon={ClipboardList}
        title="Front-desk workflows"
        subtitle="Tap a job to see every tap, in order"
        storageKey="help-staff-workflows-open"
        badge={countBadge(staffWorkflows.length, 'flow')}
      >
        <Accordion
          items={staffWorkflows}
          renderAnswer={(w) => (
            <ol className="space-y-2.5">
              {w.steps.map((s, j) => (
                <li key={j} className="flex gap-2.5 text-sm text-gray-700 leading-relaxed">
                  <span aria-hidden="true" className="shrink-0 w-5 h-5 rounded-full bg-[#bf4a53] text-white text-[11px] font-bold flex items-center justify-center mt-0.5">{j + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
        />
      </CollapsibleCard>

      {/* Status colors */}
      <CollapsibleCard
        icon={Palette}
        title="Status colors"
        subtitle="One color = one meaning, everywhere in the app"
        storageKey="help-staff-colors-open"
        defaultOpen={false}
        badge={countBadge(colorLegend.length, 'color')}
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {colorLegend.map(({ key, cls, label, desc }) => (
            <div key={key} className="flex items-start gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100">
              <span aria-hidden="true" className={`mt-1 shrink-0 w-2.5 h-2.5 rounded-full shadow-sm ${cls}`} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">{label}</p>
                <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleCard>

      {/* Catalog buttons */}
      <CollapsibleCard
        icon={Package}
        title="Catalog buttons"
        subtitle="What the buttons on an item card do, status by status"
        storageKey="help-staff-buttons-open"
        defaultOpen={false}
        badge={countBadge(inventoryActions.length + statusReference.length, 'status')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          {inventoryActions.map(({ status, PillIcon, pillCls, btnLabel, desc }) => {
            const meta = itemPill(status);
            const StatusIcon = meta.icon;
            return (
              <div key={status} className="p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${meta.bg} ${meta.text} ${meta.border}`}>
                    <StatusIcon size={10} />
                    {meta.label}
                  </span>
                  <span aria-hidden="true" className="text-gray-300 text-xs font-bold">→</span>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold ${pillCls}`}>
                    <PillIcon size={11} />
                    {btnLabel}
                  </span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
              </div>
            );
          })}
          {statusReference.map(({ status, desc }) => {
            const meta = itemPill(status);
            const StatusIcon = meta.icon;
            return (
              <div key={status} className="p-3.5 bg-gray-50/60 rounded-2xl border border-gray-100 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${meta.bg} ${meta.text} ${meta.border}`}>
                    <StatusIcon size={10} />
                    {meta.label}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-md bg-gray-200/70 text-gray-500 text-[10px] font-extrabold uppercase tracking-wide">
                    Automatic
                  </span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
              </div>
            );
          })}
        </div>
      </CollapsibleCard>

      {/* Rental statuses + alteration flags */}
      <CollapsibleCard
        icon={Ticket}
        title="Rental statuses"
        subtitle="What each transaction badge means — and whether it needs you"
        storageKey="help-staff-rentals-open"
        defaultOpen={false}
        badge={countBadge(transactionStatuses.length + alterationStatuses.length, 'badge')}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {transactionStatuses.map(({ key, Icon, desc }) => {
            const meta = txPill(key);
            return (
              <div key={key} className="flex items-start gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100 min-w-0">
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${meta.bg} ${meta.text} ${meta.border}`}>
                  <Icon size={10} />
                  {key}
                </span>
                <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
              </div>
            );
          })}
          {alterationStatuses.map(({ key, cls, desc }) => (
            <div key={key} className="flex items-start gap-3 p-3.5 bg-amber-50/60 rounded-2xl border border-amber-100 min-w-0">
              <span className={`shrink-0 inline-flex items-center px-2 py-1 rounded-full border text-[10px] font-bold ${cls}`}>
                {key}
              </span>
              <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">When an alteration flag is set, its badge replaces the booking status — only one badge per row.</p>
      </CollapsibleCard>

      {/* Dashboard labels */}
      <CollapsibleCard
        icon={LayoutDashboard}
        title="Dashboard labels"
        subtitle="Everyday terms on the staff dashboard"
        storageKey="help-staff-dashboard-open"
        defaultOpen={false}
        badge={countBadge(dashboardTerms.length, 'term')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          {dashboardTerms.map(({ Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100 min-w-0">
              <span className="shrink-0 w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center text-[#bf4a53]">
                <Icon size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">{title}</p>
                <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleCard>

      {/* FAQ */}
      <CollapsibleCard
        icon={HelpCircle}
        title="Frequently Asked Questions"
        subtitle="Tap a question for the answer"
        storageKey="help-staff-faq-open"
        defaultOpen={false}
        badge={countBadge(allFaqs.length, 'question')}
      >
        <Accordion
          items={allFaqs}
          renderAnswer={(f) => <p className="text-sm text-gray-600 leading-relaxed">{f.a}</p>}
        />
      </CollapsibleCard>
    </div>
  );
}
