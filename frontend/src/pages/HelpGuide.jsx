import { useState } from 'react';
import {
  HelpCircle, ChevronDown, ChevronUp, CheckCircle2, Wrench, Calendar,
  CalendarCheck, AlertTriangle, XCircle, Info, Sparkles,
  TrendingUp, PackageCheck, DoorOpen, ClipboardList, Play, ShieldCheck,
} from 'lucide-react';
import { itemPill, txPill } from '../utils/statusColors';
import { TERMS_SECTIONS, TermsBadge } from '../components/TermsContent';

const staffFaqs = [
  { q: 'How do I create a new rental?', a: 'Go to Dashboard and tap "+ New Rental", or open Catalog, find an Available item, and tap "Book for Customer" on its card. Follow the 3-step wizard: pick an item, enter customer details, review and confirm.' },
  { q: 'How do I process a return?', a: 'From Dashboard tap "Process Return", or find the active rental under Transactions. Check the condition, toggle any late/damage fees, then confirm. The item automatically flips to Cleaning — it goes back to Available once someone marks it cleaned. If you log a damage reason, the item skips cleaning and goes straight to Out of Service.' },
  { q: 'How do I add an item to inventory?', a: 'Tap "+ Add Item" in the header or inside Catalog. Fill in the name, category, price, and photo. Only Admins and Staff can add items; Admins can also set them on sale (discount % or fixed sale price, optionally with an end date).' },
  { q: 'How do I take an item off the floor temporarily?', a: 'Open Catalog, find the item, and tap "Pull from rental" — the item flips to Out of Service so customers can no longer book it. When the repair or cleaning is done, tap "Restore to Available" on the same card to put it back.' },
  { q: 'How do I view demand forecasts and reports?', a: 'Admins can open "AI Insights" from the sidebar — demand forecast, utilization breakdown, monthly revenue, and the "Generate AI Report" button that drafts a summary for you. See the "Insights" section below for what every term means.' },
  { q: 'What does "SMA" mean on the forecast?', a: 'SMA = Simple Moving Average (3-month). It is the average number of bookings over the last 3 months, shown as the smooth red line on the forecast chart. Because a single busy or quiet month can mislead you, the SMA evens it out so you can see the real direction of demand. See the "Insights" section below.' },
];

const customerFaqs = [
  { q: 'How do I rent an item?', a: 'Browse the Collection, pick an item that is "Available", tap "Rent Now", and follow the booking wizard. Select your pickup and event dates, choose a size, and complete the downpayment to confirm.' },
  { q: 'Can I choose my own pickup and return dates?', a: 'Yes. You select the pickup date and the event date. The item must be picked up before your event and is due back the day after.' },
  { q: 'How much do I need to pay upfront?', a: 'A 50% downpayment is required to secure your booking. The remaining balance is payable at pickup. You can pay via GCash or card.' },
  { q: 'What if I need to cancel or reschedule?', a: 'Contact the boutique directly — downpayment refunds follow the store policy.' },
  { q: 'How do I view my bookings?', a: 'Open the Transactions tab in your account for your booking history, payment status, and upcoming rentals.' },
];

// Inventory lifecycle legend (Staff/Admin only) — maps each on-card action
// button to what it actually does, so nobody has to guess from the icon.
const inventoryActions = [
  { status: 'Available', PillIcon: Wrench, pillCls: 'bg-red-50 text-red-700 border border-red-200', btnLabel: 'Pull from rental',
    desc: 'For damaged or maintenance-needed pieces. The item flips to Out of Service, is hidden from the catalog, and existing bookings stay intact.' },
  { status: 'Cleaning', PillIcon: CheckCircle2, pillCls: 'bg-emerald-600 text-white', btnLabel: 'Mark as clean',
    desc: 'After a return lands in Cleaning, press this once the item is washed. It flips straight to Available and can be rented again. In the Cleaning queue you can also select several items and "Mark selected as cleaned" at once.' },
  { status: 'OutOfService', PillIcon: CheckCircle2, pillCls: 'bg-emerald-50 text-emerald-700 border border-emerald-300', btnLabel: 'Restore to Available',
    desc: 'After a repair or cleaning finishes on an item you pulled. One tap puts it back in the catalog.' },
];

// Status reference for the "no action" states, so staff know the card
// isn't missing a button.
const statusReference = [
  { status: 'Rented', desc: 'A customer has the item. Status moves automatically as the booking progresses — no manual change needed.' },
  { status: 'Reserved', desc: 'The item is locked into an upcoming booking. Same as Rented: handled by the booking itself.' },
  { status: 'Deleted', desc: 'Soft-archived. Hidden from the catalog; only Admin can bring it back via the Restore (Undo2) icon on the card corner.' },
];

// What each transaction badge means on the dashboard / transactions list.
const transactionStatuses = [
  { key: 'Reserved', Icon: Calendar, desc: 'Booking confirmed and paid — the item is locked until pickup. Handled automatically, no action needed.' },
  { key: 'Active', Icon: PackageCheck, desc: 'The customer currently has the item — the rental is live. Moves to Returned automatically when you process the return.' },
  { key: 'Overdue', Icon: AlertTriangle, desc: 'The item was due and has not come back. Red = act now: the customer gets late-return SMS, and it stays flagged until the return is processed.' },
  { key: 'Returned', Icon: CheckCircle2, desc: 'Item is back and checked in. It flips to Cleaning automatically, then back to Available once washed.' },
  { key: 'Cancelled', Icon: XCircle, desc: 'Booking revoked. The item frees up for other customers; downpayment refunds follow store policy.' },
];

// What the colored pills across the app mean — one color = one meaning.
const colorLegend = [
  { key: 'Available', cls: 'bg-emerald-500', label: 'Emerald — good / ready', desc: 'Available, Returned, or "open" statuses. Everything is fine and the item can be rented.' },
  { key: 'Rented', cls: 'bg-blue-500', label: 'Blue — out with a customer', desc: 'Rented, Active. The item is in a customer\'s hands right now.' },
  { key: 'Reserved', cls: 'bg-indigo-400', label: 'Indigo — booked ahead', desc: 'Reserved. Locked into an upcoming booking, not yet picked up.' },
  { key: 'Cleaning', cls: 'bg-orange-400', label: 'Orange — in process', desc: 'Cleaning. Back from a rental and waiting to be washed before re-renting.' },
  { key: 'OutOfService', cls: 'bg-red-500', label: 'Red — problem / urgent', desc: 'Out of Service, Overdue. Needs attention: a repair, a follow-up, or a cancellation.' },
  { key: 'Deleted', cls: 'bg-gray-400', label: 'Gray — neutral / archived', desc: 'Archived, Cancelled. Not on the floor and not counted in live numbers.' },
];

// Everyday labels staff will see on the dashboard and why they matter.
const dashboardTerms = [
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

export default function HelpGuide({ role, onStartTutorial }) {
  const [openFaq, setOpenFaq] = useState(null);
  const [openTerm, setOpenTerm] = useState(null);
  const isCustomer = role?.toLowerCase() === 'customer';
  const isAdmin = role?.toLowerCase() === 'admin';
  const faqs = isCustomer ? customerFaqs : staffFaqs;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 md:p-10 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 relative z-10">
          <div className="flex items-center gap-3">
            <HelpCircle className="text-[#bf4a53]" size={28} />
            <h2 className="text-3xl font-bold tracking-tight">Help Guide</h2>
          </div>
          {!isCustomer && onStartTutorial && (
            <button
              onClick={onStartTutorial}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#bf4a53] hover:bg-red-600 text-white text-xs font-bold transition-colors shadow-lg shadow-red-900/40"
            >
              <Play size={13} /> Start guided tour
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
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Status colors</h3>
          <p className="text-sm text-gray-500 mb-4">One color = one meaning, everywhere in the app — on item cards, transactions, and dashboards.</p>
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm divide-y divide-gray-100/60 overflow-hidden">
            {colorLegend.map(({ key, cls, label, desc }) => (
              <div key={key} className="flex items-start gap-3 p-4">
                <span className={`mt-0.5 shrink-0 w-3 h-3 rounded-full shadow-sm ${cls}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{label}</p>
                  <p className="text-sm text-gray-600 leading-relaxed mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inventory actions */}
      {!isCustomer && (
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Inventory item actions</h3>
          <p className="text-sm text-gray-500 mb-4">What the buttons on a catalog card mean, status by status.</p>
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm divide-y divide-gray-100/60 overflow-hidden">
            {inventoryActions.map(({ status, PillIcon, pillCls, btnLabel, desc }) => {
              const meta = itemPill(status);
              const StatusIcon = meta.icon;
              return (
                <div key={status} className="flex items-start gap-3 p-4">
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${meta.bg} ${meta.text} ${meta.border}`}>
                    <StatusIcon size={10} />
                    {meta.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold mb-1.5 ${pillCls}`}>
                      <PillIcon size={11} />
                      {btnLabel}
                    </span>
                    <p className="text-sm text-gray-600 leading-relaxed">{desc}</p>
                  </div>
                </div>
              );
            })}
            {statusReference.map(({ status, desc }) => {
              const meta = itemPill(status);
              const StatusIcon = meta.icon;
              return (
                <div key={status} className="flex items-start gap-3 p-4 bg-gray-50/40">
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${meta.bg} ${meta.text} ${meta.border}`}>
                    <StatusIcon size={10} />
                    {meta.label}
                  </span>
                  <p className="text-sm text-gray-600 leading-relaxed flex-1">{desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rental statuses */}
      {!isCustomer && (
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Rental statuses</h3>
          <p className="text-sm text-gray-500 mb-4">What each badge on a transaction means — and whether it needs you or runs itself.</p>
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm divide-y divide-gray-100/60 overflow-hidden">
            {transactionStatuses.map(({ key, Icon, desc }) => {
              const meta = txPill(key);
              return (
                <div key={key} className="flex items-start gap-3 p-4">
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${meta.bg} ${meta.text} ${meta.border}`}>
                    <Icon size={10} />
                    {key}
                  </span>
                  <p className="text-sm text-gray-600 leading-relaxed flex-1">{desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dashboard labels */}
      {!isCustomer && (
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Dashboard labels</h3>
          <p className="text-sm text-gray-500 mb-4">The everyday terms you will see on the staff and admin dashboards.</p>
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm divide-y divide-gray-100/60 overflow-hidden">
            {dashboardTerms.map(({ Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-4">
                <span className="shrink-0 w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500">
                  <Icon size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{title}</p>
                  <p className="text-sm text-gray-600 leading-relaxed mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights glossary — Admin only */}
      {isAdmin && (
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Insights & reports glossary</h3>
          <p className="text-sm text-gray-500 mb-4">What the numbers in "AI Insights" actually mean.</p>
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm divide-y divide-gray-100/60 overflow-hidden">
            {insightsTerms.map(({ term, Icon, desc }) => (
              <div key={term} className="flex items-start gap-3 p-4">
                <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#bf4a53]/10 border border-[#bf4a53]/20 text-[#bf4a53] text-[11px] font-bold">
                  <Icon size={12} />
                  {term}
                </span>
                <p className="text-sm text-gray-600 leading-relaxed flex-1">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FAQ */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-4">Frequently Asked Questions</h3>
        <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm divide-y divide-gray-100/50 overflow-hidden">
          {faqs.map((faq, i) => (
            <div key={i}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50/50 transition-colors"
              >
                <span className="font-semibold text-sm text-gray-900">{faq.q}</span>
                {openFaq === i ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
              </button>
              {openFaq === i && (
                <div className="px-5 pb-5">
                  <p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Terms & Conditions + Privacy Policy — collapsible dropdowns */}
      <div>
        <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-1 flex items-center gap-2">
          <ShieldCheck size={18} className="text-emerald-600 shrink-0" /> Terms and Conditions &amp; Privacy Policy
        </h3>
        <p className="text-xs sm:text-sm text-gray-500 mb-4 leading-relaxed">
          Our full terms — covering the rental business policies, website usage, and your rights under the Philippine Data Privacy Act of 2012 (RA 10173). Tap each section to expand it.
        </p>
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-gray-100/80 shadow-sm overflow-hidden">
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
      </div>
    </div>
  );
}