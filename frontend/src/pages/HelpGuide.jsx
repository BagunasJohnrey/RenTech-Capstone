import { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp, CheckCircle2, Wrench } from 'lucide-react';
import { itemPill } from '../utils/statusColors';

const staffFaqs = [
  { q: 'How do I create a new rental?', a: 'Go to Dashboard and tap "+ New Rental", or open Catalog, find an Available item, and tap "Book for Customer" on its card. Follow the 3-step wizard: pick an item, enter customer details, review and confirm.' },
  { q: 'How do I process a return?', a: 'From Dashboard tap "Process Return", or find the active rental under Transactions. Check the condition, toggle any late/damage fees, then confirm. The item automatically flips to Cleaning — it goes back to Available once someone marks it cleaned.' },
  { q: 'How do I add an item to inventory?', a: 'Tap "+ Add Item" in the header or inside Catalog. Fill in the name, category, price, and photo. Only Admins and Staff can add items; Admins can also set them on sale.' },
  { q: 'How do I take an item off the floor temporarily?', a: 'Open Catalog, find the item, and tap "Pull from rental" — the item flips to Out of Service so customers can no longer book it. When the repair or cleaning is done, tap "Restore to Available" on the same card to put it back.' },
  { q: 'How do I view demand forecasts and reports?', a: 'Admins can open "AI Insights" from the sidebar — demand forecast, utilization breakdown, monthly revenue, and the "Generate AI Report" button that drafts a summary for you.' },
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
    desc: 'After a return lands in Cleaning, press this once the item is washed. It flips straight to Available and can be rented again.' },
  { status: 'OutOfService', PillIcon: CheckCircle2, pillCls: 'bg-emerald-50 text-emerald-700 border border-emerald-300', btnLabel: 'Restore to Available',
    desc: 'After a repair or cleaning finishes on an item you pulled. One tap puts it back in the catalog.' },
];

// Status reference for the two "no action" states, so staff know the card
// isn't missing a button.
const statusReference = [
  { status: 'Rented', desc: 'A customer has the item. Status moves automatically as the booking progresses — no manual change needed.' },
  { status: 'Reserved', desc: 'The item is locked into an upcoming booking. Same as Rented: handled by the booking itself.' },
  { status: 'Deleted', desc: 'Soft-archived. Hidden from the catalog; only Admin can bring it back via the Restore (Undo2) icon on the card corner.' },
];

export default function HelpGuide({ role }) {
  const [openFaq, setOpenFaq] = useState(null);
  const isCustomer = role?.toLowerCase() === 'customer';
  const faqs = isCustomer ? customerFaqs : staffFaqs;

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 md:p-10 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="flex items-center gap-3 mb-4 relative z-10">
          <HelpCircle className="text-[#bf4a53]" size={28} />
          <h2 className="text-3xl font-bold tracking-tight">Help Guide</h2>
        </div>
        <p className="text-gray-400 font-medium max-w-xl relative z-10 leading-relaxed">
          {isCustomer
            ? 'Answers to common booking questions and how to rent from us.'
            : 'Inventory button reference and answers to common questions.'}
        </p>
      </div>

      {/* Inventory actions legend — Staff & Admin only */}
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
                    {/* Live pill preview so the doc looks like the card. */}
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
    </div>
  );
}

