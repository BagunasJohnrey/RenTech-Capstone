import { useState } from 'react';
import { HelpCircle, LayoutGrid, ShoppingBag, Undo2, MessageCircle, ChevronDown, ChevronUp, Calendar, User, CreditCard } from 'lucide-react';

const staffTutorialCards = [
  { icon: LayoutGrid, title: 'Your Dashboard', desc: 'Your daily tasks and key metrics are right here.' },
  { icon: ShoppingBag, title: 'New Rentals', desc: 'Create a rental in 3 easy steps — pick, details, confirm.' },
  { icon: Undo2, title: 'Processing Returns', desc: 'Check condition, assess fees, and confirm returns.' },
  { icon: MessageCircle, title: 'Need Help?', desc: 'Tap Help anytime in the sidebar menu.' },
];

const staffFaqs = [
  { q: 'How do I create a new rental?', a: 'Go to Dashboard and tap "+ New Rental" or use the FAB button. Follow the 3-step wizard: pick an item, enter customer details, review and confirm.' },
  { q: 'How do I process a return?', a: 'From Dashboard tap "Process Return" or go to Transactions and find the active rental. Review condition, toggle late/damage fees, then confirm.' },
  { q: 'How do I add inventory items?', a: 'Tap the "+ Add Item" button in the header. Fill in name, category, price, and photo. Only Admins and Staff can add items.' },
  { q: 'How do I view business insights?', a: 'Admins can access "AI Insights" from the sidebar. View demand forecasts, utilisation rates, and generate AI-powered reports.' },
  { q: 'What happens when I go offline?', a: 'You can still create rentals and process returns. They will be queued and synced automatically when your connection returns.' },
];

const customerTutorialCards = [
  { icon: ShoppingBag, title: 'Browse Collection', desc: 'Explore gowns, suits, and formal wear available for rent.' },
  { icon: Calendar, title: 'Book an Item', desc: 'Select your dates, choose your size, and confirm your booking.' },
  { icon: User, title: 'My Transactions', desc: 'View your booking history, receipts, and upcoming rentals.' },
  { icon: CreditCard, title: 'Payments & Downpayment', desc: 'Secure your booking with a 50% downpayment via GCash or card.' },
];

const customerFaqs = [
  { q: 'How do I rent an item?', a: 'Browse the Collection, pick an item that is "Available", tap "Book", and follow the booking wizard. Select your pickup and event dates, choose a size, and complete the downpayment to confirm.' },
  { q: 'Can I choose my own pickup and return dates?', a: 'Yes. You select the pickup date and the event date. The item must be picked up before your event and is due back the day after the event.' },
  { q: 'How much do I need to pay upfront?', a: 'A 50% downpayment is required to secure your booking. The remaining balance is payable at pickup. You can pay via GCash or card.' },
  { q: 'What if I need to cancel or reschedule?', a: 'Contact the boutique directly to discuss cancellations or rescheduling. Downpayment refunds are subject to the store policy.' },
  { q: 'How do I view my bookings?', a: 'Go to the Transactions tab in your account to see your booking history, payment status, and upcoming rental schedule.' },
];

export default function HelpGuide({ role, onStartTutorial }) {
  const [openFaq, setOpenFaq] = useState(null);
  const isCustomer = role?.toLowerCase() === 'customer';
  const tutorialCards = isCustomer ? customerTutorialCards : staffTutorialCards;
  const faqs = isCustomer ? customerFaqs : staffFaqs;

  return (
    <div className="max-w-2xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 md:p-10 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="flex items-center gap-3 mb-4 relative z-10">
          <HelpCircle className="text-[#bf4a53]" size={28} />
          <h2 className="text-3xl font-bold tracking-tight">Help Guide</h2>
        </div>
        <p className="text-gray-400 font-medium max-w-xl relative z-10 leading-relaxed">
          Quick tutorials and answers to common questions for {role.toLowerCase()} users.
        </p>
      </div>

      {/* Tutorial cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Quick Tutorials</h3>
          {onStartTutorial && (
            <button onClick={onStartTutorial}
              className="text-xs font-bold text-[#bf4a53] hover:text-red-700 transition-colors underline underline-offset-2">
              Start Tutorial
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tutorialCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <div key={i} className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm hover:shadow-md transition-shadow">
                <div className="p-3 bg-red-50 rounded-2xl inline-block mb-4">
                  <Icon size={24} className="text-[#bf4a53]" />
                </div>
                <h4 className="font-bold text-gray-900 mb-1">{card.title}</h4>
                <p className="text-sm text-gray-500 leading-relaxed">{card.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

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

