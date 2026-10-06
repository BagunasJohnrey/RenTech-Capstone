import { useState, useCallback, useEffect } from 'react';
import { ShoppingBag, ChevronRight, ChevronLeft, Search, Calendar, User, X, CheckCircle2, CreditCard as PayIcon, FileText, LayoutDashboard, Sparkles, Package } from 'lucide-react';

const customerSteps = [
  {
    icon: Search, title: 'Browse the Collection',
    desc: 'Explore gowns, suits, and formal wear available for rent. Tap any item to see details and check availability.',
    detail: 'Available items show a "Rent Now" button. Unavailable items are marked.',
  },
  {
    icon: Calendar, title: 'Select Dates & Book',
    desc: 'Choose your pickup date and event date. The item must be picked up before your event.',
    detail: 'Return is due the day after your event. A minimum downpayment secures your booking; the rest is due at pickup — the item is released only once fully paid.',
  },
  {
    icon: User, title: 'Enter Your Details',
    desc: 'Fill in your name, contact number, and address. Select your size or enter custom measurements.',
    detail: 'You can book for yourself or someone else. Add special notes if needed.',
  },
  {
    icon: PayIcon, title: 'Confirm & Pay',
    desc: 'Review your booking summary and pay the downpayment via GCash or card.',
    detail: 'After payment, you will receive a booking confirmation with your transaction ID and QR code. Settle the remaining balance at pickup (cash or online) — pickup and return are locked until fully paid.',
  },
];

const staffSteps = [
  {
    icon: ShoppingBag, title: 'Select an Item',
    desc: 'Browse available garments in the catalog. Search by name or filter by category (gown, suit, formal).',
    detail: 'Tap an item to select it, then click "Continue" to proceed.',
  },
  {
    icon: User, title: 'Enter Customer & Rental Details',
    desc: 'Fill in customer name, contact, and address. Set pickup date, event date, and select a size.',
    detail: 'Return date is auto-calculated (event date + 1 day). Optional: downpayment, notes, and condition photo. Full payment is required before release — collect it in the release sheet (Cash or Online).',
  },
  {
    icon: FileText, title: 'Review & Confirm',
    desc: 'Check the booking summary — customer, dates, item, and pricing.',
    detail: 'Tap "Confirm & Process" to create the rental. A confirmation toast will appear.',
  },
  {
    icon: CheckCircle2, title: 'Rental Created',
    desc: 'The rental is now active. The item status changes to Reserved.',
    detail: 'Collect the full balance before release, and process the return only when fully paid. You can view it in Transactions.',
  },
];

const adminSteps = [
  {
    icon: LayoutDashboard, title: 'Your Dashboard',
    desc: 'Start with the Dashboard — today\'s revenue, due returns, inventory health, and overdue follow-ups at a glance.',
    detail: 'Tap any KPI card to jump straight to the related tab.',
  },
  {
    icon: Package, title: 'Manage Inventory',
    desc: 'Track every garment — Available, Rented, Reserved, In Cleaning, or Out of Service.',
    detail: 'Add items, attach photos, mark items On Sale, and batch-clean returns from the Cleaning Queue.',
  },
  {
    icon: CheckCircle2, title: 'Bookings & Returns',
    desc: 'Process new rentals, scan QR codes, and handle returns — damaged pieces go Out of Service automatically.',
    detail: 'No-shows and overdue rentals are flagged automatically so you can follow up.',
  },
  {
    icon: Sparkles, title: 'AI Insights & Settings',
    desc: 'AI Insights builds business reports and suggestions from real transaction data.',
    detail: 'In Settings: business rules, SMS templates, staff accounts, and secure MFA (two-factor) sign-in.',
  },
];

const stepColors = [
  'bg-blue-50 text-blue-600',
  'bg-emerald-50 text-emerald-600',
  'bg-orange-50 text-orange-600',
  'bg-purple-50 text-purple-600',
];

const stepNumbers = ['01', '02', '03', '04'];

// One storage key per role so staff/admin/customer tutorials are independent.
const storageKeyFor = (role) => {
  const r = (role || '').toLowerCase();
  return r === 'customer' ? 'onboardingDone_Customer' : r === 'admin' ? 'onboardingDone_Admin' : 'onboardingDone_Staff';
};

// Accent color per step index (tint matching the icon chip).
const accentFor = (idx) =>
  idx === 0 ? 'bg-blue-500' : idx === 1 ? 'bg-emerald-500' : idx === 2 ? 'bg-orange-500' : 'bg-purple-500';

export default function OnboardingTutorial({ role, onComplete }) {
  const [step, setStep] = useState(0);
  // Slide direction for the content transition: +1 = Next (slides in from
  // the right), -1 = Back (slides in from the left).
  const [dir, setDir] = useState(1);
  const roleKey = (role || '').toLowerCase();
  const steps = roleKey === 'customer' ? customerSteps : roleKey === 'admin' ? adminSteps : staffSteps;
  const storageKey = storageKeyFor(role);
  const card = steps[step];
  const Icon = card.icon;

  const finish = useCallback(() => {
    localStorage.setItem(storageKey, 'true');
    onComplete();
  }, [storageKey, onComplete]);

  const handleNext = useCallback(() => {
    if (step < steps.length - 1) {
      setDir(1);
      setStep(s => s + 1);
    } else {
      finish();
    }
  }, [step, steps.length, finish]);

  const handlePrev = useCallback(() => {
    if (step > 0) {
      setDir(-1);
      setStep(s => s - 1);
    }
  }, [step]);

  const goTo = useCallback((i) => {
    if (i === step) return;
    setDir(i > step ? 1 : -1);
    setStep(i);
  }, [step]);

  // Keyboard navigation: arrows move, Escape closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') handleNext();
      else if (e.key === 'ArrowLeft') handlePrev();
      else if (e.key === 'Escape') finish();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleNext, handlePrev, finish]);

  const totalSteps = steps.length;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={finish} />

      {/* Stable card: the entrance zoom plays ONCE on mount. Only the inner
          content below remounts per step (directional slide), so Next/Back
          never flashes the whole modal. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Getting started tutorial"
        className="relative w-full max-w-md animate-in fade-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-100/80 overflow-hidden max-h-[88vh] flex flex-col">
          {/* Colored accent bar + progress fill */}
          <div className="relative h-1.5 bg-gray-100">
            <div
              className={`absolute inset-y-0 left-0 transition-all duration-300 ease-out ${accentFor(step)}`}
              style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
            />
          </div>

          {/* Step number badge + close */}
          <div className="flex items-center justify-between px-6 pt-4">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-[#bf4a53]" />
              Step {stepNumbers[step]} of {totalSteps}
            </span>
            <button onClick={finish} aria-label="Close tutorial" className="p-1 -mr-1 text-gray-300 hover:text-gray-500 transition-colors shrink-0">
              <X size={16} />
            </button>
          </div>

          <div className="p-6 pt-4 sm:p-7 sm:pt-4 overflow-y-auto min-h-0">
            {/* Step body: the ONLY remounting part. Short directional slide
                (no zoom, no backdrop flash) keeps Next/Back buttery. */}
            <div
              key={step}
              aria-live="polite"
              className={`animate-in fade-in duration-200 ${dir >= 0 ? 'slide-in-from-right-4' : 'slide-in-from-left-4'}`}
            >
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-2xl shrink-0 transition-colors duration-300 ${stepColors[step]}`}>
                  <Icon size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg text-gray-900">{card.title}</h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{card.desc}</p>
                </div>
              </div>

              {/* Extra detail box */}
              <div className="mt-4 bg-gray-50 rounded-xl p-3.5 border border-gray-100/60">
                <div className="flex items-start gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#bf4a53] mt-1.5 shrink-0" />
                  <p className="text-xs text-gray-500 leading-relaxed">{card.detail}</p>
                </div>
              </div>
            </div>

            {/* Progress & navigation (stable, never remounts) */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <div className="flex gap-1.5" role="tablist" aria-label="Tutorial steps">
                {steps.map((s, i) => (
                  <button
                    key={i}
                    role="tab"
                    aria-selected={i === step}
                    aria-label={`Go to step ${i + 1}: ${s.title}`}
                    onClick={() => goTo(i)}
                    className={`h-1.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50 ${i === step ? 'w-6 bg-[#bf4a53]' : i < step ? 'w-2 bg-[#bf4a53]/40 hover:bg-[#bf4a53]/60' : 'w-2 bg-gray-200 hover:bg-gray-300'}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button onClick={handlePrev}
                    className="px-3 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors flex items-center gap-1">
                    <ChevronLeft size={14} /> Back
                  </button>
                )}
                <button onClick={handleNext}
                  className={`px-5 py-2 text-xs font-bold rounded-full transition-colors flex items-center gap-1 ${
                    step < totalSteps - 1
                      ? 'bg-[#bf4a53] text-white hover:bg-red-700 active:scale-[0.98]'
                      : 'bg-gray-900 text-white hover:bg-gray-800 active:scale-[0.98]'
                  }`}>
                  {step < totalSteps - 1 ? <>Next <ChevronRight size={14} /></> : 'Done'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
