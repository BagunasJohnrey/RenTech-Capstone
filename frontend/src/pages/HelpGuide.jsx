import { useState } from 'react';
import {
  HelpCircle, ChevronDown, ChevronUp, CheckCircle2, Wrench, Calendar,
  CalendarCheck, AlertTriangle, XCircle, Info, Sparkles,
  TrendingUp, PackageCheck, DoorOpen, ClipboardList, Play, ShieldCheck,
  Palette, Package, Ticket, LayoutDashboard, RotateCcw,
} from 'lucide-react';
import { itemPill, txPill } from '../utils/statusColors';
import { TERMS_SECTIONS, TermsBadge } from '../components/TermsContent';
import CollapsibleCard from '../components/settings/CollapsibleCard';
import HelpAccordion from '../components/HelpAccordion';

const countBadge = (n, singular) => (
  <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] text-[11px] font-bold tabular-nums">
    {n} {singular}{n === 1 ? '' : 's'}
  </span>
);

export const staffFaqs = [
  { q: 'How do I create a new rental?', a: 'Go to Dashboard and tap "+ New Rental", or open Catalog, find an Available item, and tap it to start booking straight away. Follow the 3-step wizard: pick an item, enter customer details, review and confirm.' },
  { q: 'How do I release an item for pickup?', a: 'Open the Reserved booking → "Release". Full payment is required first: collect the outstanding balance in the sheet (Cash tab, or Online via PayMongo/Maya QR) and the release unlocks once the balance is ₱0. Then capture the condition photo and Confirm — the rental goes Active.' },
  { q: 'How do I verify a manual-QR payment proof?', a: 'Open Tasks and find "Payments to verify" (or a "Verify payment proof" priority row). Compare the screenshot, reference, and channel with the amount claimed, then Approve & credit — or Reject with a reason so the customer can re-upload. Unverified QR bookings never appear in Ready for Pickup, and approving credits the downpayment through the ledger.' },
  { q: 'How do I process a return?', a: 'From Dashboard tap "Process Return", or find the active rental under Records. Returns are accepted only when fully paid — settle any outstanding balance first (Record Payment: Cash or Online). Pick the condition: Good sends the item to Cleaning (back to Available once washed); Damaged needs a reason and an optional custom fee, and takes the item Out of Service. A damage fee may leave a new balance, which stays payable on the Returned record. Add a condition photo if you like, then Confirm — the button locks while it processes so a double-tap can\u2019t file it twice.' },
  { q: 'How do I add an item to inventory?', a: 'Tap "+ Add Item" in the header or inside Catalog. Fill in the name, category, price, and photo. Only Admins and Staff can add items; Admins can also set them on sale (discount % or fixed sale price, optionally with an end date).' },
  { q: 'How do I take an item off the floor temporarily?', a: 'Open Catalog, find the item, and tap "Pull from rental" — the item flips to Out of Service so customers can no longer book it. When the repair or cleaning is done, tap "Restore to Available" on the same card to put it back.' },
  { q: 'How do I view demand forecasts and reports?', a: 'Admins can open "AI Insights" from the sidebar — demand forecast, utilization breakdown, monthly revenue, and the "Generate AI Report" button that drafts a summary for you. See the "Insights" section below for what every term means.' },
  { q: 'What does "SMA" mean on the forecast?', a: 'SMA = Simple Moving Average (3-month). It is the average number of bookings over the last 3 months, shown as the smooth red line on the forecast chart. Because a single busy or quiet month can mislead you, the SMA evens it out so you can see the real direction of demand. See the "Insights" section below.' },
];

const customerFaqs = [
  { q: 'How do I rent an item?', a: 'Browse the Collection, pick an item that is "Available", tap "Rent Now", and follow the booking wizard. Select your pickup and event dates, choose a size, and complete the downpayment to confirm. If the boutique uses Manual QR, upload your transfer screenshot and the booking stays under review until staff verify it.' },
  { q: 'Can I choose my own pickup and return dates?', a: 'Yes. You select the pickup date and the event date. The item must be picked up before your event and is due back the day after.' },
  { q: 'How much do I need to pay upfront?', a: 'A minimum downpayment of ₱200 is required to secure your booking. The remaining balance is payable at pickup — the item is released only once fully paid, so please settle the full amount (cash or online via GCash/card) before or at pickup.' },
  { q: 'How do I pay with the boutique\'s QR?', a: 'At checkout choose Manual QR, scan the shop\'s InstaPay / GCash QR, then upload a clear screenshot and the reference number. The booking shows "Payment under review" until staff verify it; pickup is not scheduled until the downpayment is approved. If it is rejected, re-upload a clearer proof from My Rentals.' },
  { q: 'Do I need to pay in full before pickup and return?', a: 'Yes. Pickup (release) and return are both locked until your balance is ₱0. Pay the remaining balance at the counter (cash or online) before pickup; returns are accepted only when fully paid. A damage fee found at return may leave a new balance, which you can settle right after.' },
  { q: 'What if I need to cancel or reschedule?', a: 'Contact the boutique directly — downpayment refunds follow the store policy.' },
  { q: 'How do I view my bookings?', a: 'Open the Transactions tab in your account for your booking history, payment status, and upcoming rentals.' },
];

// Inventory lifecycle legend (Staff/Admin only) — maps each on-card action
// button to what it actually does, so nobody has to guess from the icon.
export const inventoryActions = [
  { status: 'Available', PillIcon: Wrench, pillCls: 'bg-white text-gray-400 border border-gray-200', btnLabel: 'Pull from rental',
    desc: 'For damaged or maintenance-needed pieces. The item flips to Out of Service, is hidden from the catalog, and existing bookings stay intact.' },
  { status: 'Cleaning', PillIcon: CheckCircle2, pillCls: 'bg-emerald-600 text-white', btnLabel: 'Mark as clean',
    desc: 'After a return lands in Cleaning, press this once the item is washed. It flips straight to Available and can be rented again. In the Cleaning queue you can also select several items and "Mark selected as cleaned" at once.' },
  { status: 'OutOfService', PillIcon: RotateCcw, pillCls: 'bg-emerald-50 text-emerald-700 border border-emerald-200', btnLabel: 'Restore to Available',
    desc: 'After a repair or cleaning finishes on an item you pulled. One tap puts it back in the catalog.' },
];

// Status reference for the "no action" states, so staff know the card
// isn't missing a button.
export const statusReference = [
  { status: 'Rented', desc: 'A customer has the item. Status moves automatically as the booking progresses — no manual change needed.' },
  { status: 'Reserved', desc: 'The item is locked into an upcoming booking. Same as Rented: handled by the booking itself.' },
  { status: 'Deleted', desc: 'Soft-archived. Hidden from the catalog; only Admin can bring it back via the Restore (Undo2) icon on the card corner.' },
];

// What each transaction badge means on the dashboard / transactions list.
export const transactionStatuses = [
  { key: 'Reserved', Icon: Calendar, desc: 'Booking confirmed and paid — the item is locked until pickup. Handled automatically, no action needed.' },
  { key: 'Active', Icon: PackageCheck, desc: 'The customer currently has the item — the rental is live. Moves to Returned automatically when you process the return.' },
  { key: 'Overdue', Icon: AlertTriangle, desc: 'The item was due and has not come back. Red = act now: the customer gets late-return SMS, and it stays flagged until the return is processed.' },
  { key: 'Returned', Icon: CheckCircle2, desc: 'Item is back and checked in. It flips to Cleaning automatically, then back to Available once washed.' },
  { key: 'Cancelled', Icon: XCircle, desc: 'Booking revoked. The item frees up for other customers; downpayment refunds follow store policy.' },
];

// Alteration flags (from the glossary) — when set, the alteration badge
// replaces the booking status so there is only ever one badge per row.
export const alterationStatuses = [
  { key: 'Alteration Pending', cls: 'bg-amber-50 text-amber-600 border-amber-200', desc: 'The piece needs fitting work (e.g. hemming) before it can be released.' },
  { key: 'Alteration Ready', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200', desc: 'Fitting work is done — the piece is ready to release.' },
];

// What the colored pills across the app mean — one color = one meaning.
export const colorLegend = [
  { key: 'Available', cls: 'bg-emerald-500', label: 'Emerald — good / ready', desc: 'Available, Returned, or "open" statuses. Everything is fine and the item can be rented.' },
  { key: 'Rented', cls: 'bg-blue-500', label: 'Blue — out with a customer', desc: 'Rented, Active. The item is in a customer\'s hands right now.' },
  { key: 'Reserved', cls: 'bg-indigo-400', label: 'Indigo — booked ahead', desc: 'Reserved. Locked into an upcoming booking, not yet picked up.' },
  { key: 'Cleaning', cls: 'bg-orange-400', label: 'Orange — in process', desc: 'Cleaning. Back from a rental and waiting to be washed before re-renting.' },
  { key: 'OutOfService', cls: 'bg-red-500', label: 'Red — problem / urgent', desc: 'Out of Service, Overdue. Needs attention: a repair, a follow-up, or a cancellation.' },
  { key: 'Deleted', cls: 'bg-gray-400', label: 'Gray — neutral / archived', desc: 'Archived, Cancelled. Not on the floor and not counted in live numbers.' },
];

// Everyday labels staff will see on the dashboard and why they matter.
export const dashboardTerms = [
  { Icon: ClipboardList, title: 'Today\'s Priority', desc: 'The action queue the system builds for you — pickups due, returns due, and overdue follow-ups, ranked by urgency.' },
  { Icon: DoorOpen, title: 'Pickups Today', desc: 'Rented items scheduled to be handed over today. Hand the item out to start the Active rental.' },
  { Icon: CalendarCheck, title: 'Due Today / "d overdue"', desc: 'Items expected back today. Once a rental passes its due date it turns red and is counted as overdue — chase the customer.' },
  { Icon: Sparkles, title: 'Cleaning queue', desc: 'Returned items waiting to be washed. Use the bulk-select + "Mark selected as cleaned" so they go back on the floor as a batch.' },
  { Icon: Info, title: 'No-show notice', desc: 'If a customer never picked up, you get a notification about a day after pickup — it asks whether to cancel the booking.' },
  { Icon: TrendingUp, title: 'KPI cards', desc: 'The headline numbers on the dashboard — revenue collected, active rentals, overdue count, utilization. Hover the info icons for details.' },
];

// What the AI Insights numbers mean (Admin).
const insightsTerms = [
  { term: 'SMA (3 mo)', Icon: TrendingUp, desc: 'Simple Moving Average — the average number of bookings over the trailing 3 months. The smooth red line on the forecast chart. It filters out one-off spikes so you can read the real trend; the app needs at least 3 months of history and tells you how many more are missing.' },
  { term: 'Demand forecast', Icon: Sparkles, desc: 'The next month\'s expected demand, estimated from the current SMA. Once enough real revenue exists it is also shown in pesos (forecasted rentals × average price); before that, only the direction (up / down) is shown.' },
  { term: 'Utilization', Icon: ClipboardList, desc: 'How much of the month your catalog was actually rented out versus sitting idle. A low number means the item or store is under-booked.' },
  { term: 'AI Report', Icon: Info, desc: 'A written summary of your KPIs and insights drafted by the AI. Every peso figure is checked against the real data before it is shown — if the AI provider is busy (rate-limited) you will see a notice and can retry later.' },
];

export default function HelpGuide({ role, onStartTutorial, fluid = false }) {
  const [openTerm, setOpenTerm] = useState(null);
  const isCustomer = role?.toLowerCase() === 'customer';
  const isAdmin = role?.toLowerCase() === 'admin';
  const isStaff = !isCustomer && !isAdmin;
  const faqs = isCustomer ? customerFaqs : staffFaqs;

  return (
    // `fluid` (admin Settings tab): fill the wide tab instead of sitting in
    // a narrow centered column with dead margins on desktop.
    <div className={`${fluid ? 'max-w-none' : 'max-w-3xl mx-auto'} space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700`}>
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 md:p-10 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 relative z-10">
          <div className="flex items-center gap-3">
            <HelpCircle className="text-[#bf4a53]" size={28} />
            <h2 className="text-3xl font-bold tracking-tight">Help Guide</h2>
          </div>
          {onStartTutorial && (
            <button
              onClick={onStartTutorial}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#bf4a53] hover:bg-red-600 text-white text-xs font-bold transition-colors shadow-lg shadow-red-900/40"
            >
              <Play size={13} /> {isCustomer ? 'Replay guided tour' : 'Start guided tour'}
            </button>
          )}
        </div>
        <p className="text-gray-400 font-medium max-w-xl relative z-10 leading-relaxed">
          {isCustomer
            ? 'Answers to common booking questions and how to rent from us.'
            : 'Everything you need to run the shop — status colors, button meanings, dashboard labels, and the AI insights glossary.'}
        </p>
      </div>

      {/* Status colors — Staff & Admin only */}
      {!isCustomer && (
        <CollapsibleCard
          icon={Palette}
          iconClass="bg-violet-50 text-violet-600"
          title="Status colors"
          subtitle="One color = one meaning, everywhere in the app — on item cards, transactions, and dashboards."
          storageKey="help-colors-open"
          defaultOpen={false}
          badge={countBadge(colorLegend.length, 'color')}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {colorLegend.map(({ key, cls, label, desc }) => (
              <div key={key} className="flex items-start gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100">
                <span aria-hidden="true" className={`mt-1 shrink-0 w-2.5 h-2.5 rounded-full shadow-sm ${cls}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{label}</p>
                  <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {/* Inventory actions */}
      {!isCustomer && (
        <CollapsibleCard
          icon={Package}
          iconClass="bg-blue-50 text-blue-600"
          title="Inventory item actions"
          subtitle="What the buttons on a catalog card mean, status by status."
          storageKey="help-actions-open"
          defaultOpen={false}
          badge={countBadge(inventoryActions.length + statusReference.length, 'status')}
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
      )}

      {/* Rental statuses */}
      {!isCustomer && (
        <CollapsibleCard
          icon={Ticket}
          iconClass="bg-indigo-50 text-indigo-600"
          title="Rental statuses"
          subtitle="What each badge on a transaction means — and whether it needs you or runs itself."
          storageKey="help-rentals-open"
          defaultOpen={false}
          badge={countBadge(transactionStatuses.length + alterationStatuses.length, 'badge')}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
      )}

      {/* Dashboard labels */}
      {!isCustomer && (
        <CollapsibleCard
          icon={LayoutDashboard}
          iconClass="bg-emerald-50 text-emerald-600"
          title="Dashboard labels"
          subtitle="The everyday terms you will see on the staff and admin dashboards."
          storageKey="help-dashboard-open"
          defaultOpen={false}
          badge={countBadge(dashboardTerms.length, 'term')}
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {dashboardTerms.map(({ Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100 min-w-0">
                <span className="shrink-0 w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center text-[#bf4a53]">
                  <Icon size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {/* Insights glossary — Admin only */}
      {isAdmin && (
        <CollapsibleCard
          icon={TrendingUp}
          iconClass="bg-[#bf4a53]/10 text-[#bf4a53]"
          title="Insights & reports glossary"
          subtitle="What the numbers in “AI Insights” actually mean."
          storageKey="help-insights-open"
          defaultOpen={false}
          badge={countBadge(insightsTerms.length, 'term')}
        >
          <div className="grid gap-2 md:grid-cols-2">
            {insightsTerms.map(({ term, Icon, desc }) => (
              <div key={term} className="p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#bf4a53]/10 border border-[#bf4a53]/20 text-[#bf4a53] text-[11px] font-bold mb-2">
                  <Icon size={12} />
                  {term}
                </span>
                <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {/* FAQ */}
      <CollapsibleCard
        icon={HelpCircle}
        iconClass="bg-amber-50 text-amber-600"
        title="Frequently Asked Questions"
        subtitle="Tap a question for the answer"
        storageKey="help-faq-open"
        defaultOpen={isCustomer}
        badge={countBadge(faqs.length, 'question')}
      >
        <HelpAccordion
          items={faqs}
          renderAnswer={(faq) => <p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p>}
        />
      </CollapsibleCard>

      {/* Terms & Conditions + Privacy Policy — collapsible dropdowns.
          Hidden for staff (customer-facing legal text, not front-desk ops). */}
      {!isStaff && (
      <CollapsibleCard
        icon={ShieldCheck}
        iconClass="bg-emerald-50 text-emerald-600"
        title="Terms and Conditions & Privacy Policy"
        subtitle="Rental policies, website use, and your rights under the Data Privacy Act of 2012 (RA 10173)."
        storageKey="help-terms-open"
        defaultOpen={false}
        badge={countBadge(TERMS_SECTIONS.length, 'section')}
      >
        <div className="rounded-2xl border border-gray-100 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100/60 bg-gray-50/40">
            <TermsBadge
              label="Effective date: August 2026"
              sub="By creating an account or using RenTech, you agree to the terms below."
            />
          </div>
          <div className="divide-y divide-gray-100/50">
            {TERMS_SECTIONS.map((section, i) => {
              const isOpen = openTerm === i;
              return (
                <div key={section.id}>
                  <button
                    onClick={() => setOpenTerm(isOpen ? null : i)}
                    className="w-full flex items-start sm:items-center justify-between gap-2 sm:gap-3 p-3.5 sm:p-4 text-left hover:bg-gray-50/50 transition-colors"
                  >
                    <span className="flex-1 pr-1 font-semibold text-[13px] sm:text-sm text-gray-900 leading-snug">{section.title}</span>
                    <span className={`mt-0.5 sm:mt-0 shrink-0 rounded-lg border p-1 transition-colors ${isOpen ? 'bg-[#bf4a53]/10 border-[#bf4a53]/20 text-[#bf4a53]' : 'border-gray-200 text-gray-400'}`}>
                      {isOpen ? <ChevronUp size={14} className="sm:hidden" /> : <ChevronDown size={14} className="sm:hidden" />}
                      {isOpen ? <ChevronUp size={16} className="hidden sm:block" /> : <ChevronDown size={16} className="hidden sm:block" />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3.5 sm:px-4 pb-3.5 sm:pb-4">
                      {section.paragraphs?.map((p, j) => (
                        <p key={j} className="text-[13px] sm:text-sm text-gray-600 leading-relaxed mb-1.5">{p}</p>
                      ))}
                      {section.bullets && (
                        <ul className="space-y-1.5 mb-1.5 mt-1.5">
                          {section.bullets.map((b, j) => (
                            <li key={j} className="text-[13px] sm:text-sm text-gray-600 leading-relaxed flex gap-1.5 sm:gap-2">
                              <span className="w-1 h-1 rounded-full bg-[#bf4a53] inline-block mt-1.5 shrink-0" />
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {section.closingParagraphs?.map((p, j) => (
                        <p key={j} className="text-[13px] sm:text-sm text-gray-600 leading-relaxed mb-1.5">{p}</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CollapsibleCard>
      )}
    </div>
  );
}