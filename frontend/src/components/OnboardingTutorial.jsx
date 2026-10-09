import { useState, useCallback, useEffect, useRef } from 'react';
import { ShoppingBag, ChevronRight, ChevronLeft, Search, Calendar, User, CheckCircle2, CreditCard as PayIcon, FileText, LayoutDashboard, Sparkles, Package, Settings, ClipboardList, Tag } from 'lucide-react';

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
    desc: 'Review your booking summary and pay the downpayment via e-wallet.',
    detail: 'After payment, you get a confirmation with your booking details. Settle the balance at pickup — release stays locked until fully paid.',
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
    icon: CheckCircle2, title: 'Release & Return',
    desc: 'Collect the full balance and release the item with a QR scan. On return, snap a condition photo — intact pieces go to Cleaning, damaged ones to Out of Service with a reason.',
    detail: 'Release and returns stay locked until fully paid. Past rentals live in Logs & Returns.',
  },
  {
    icon: ClipboardList, title: 'Tasks & Reminders',
    desc: 'Work the queue every shift — the Dashboard and Tasks tab line up pickups, dues, overdues, and cleaning.',
    detail: 'Send due-today reminders and overdue SMS in one tap. No-shows flag 1 day past pickup; mark cleaned batches in the Cleaning Queue.',
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
    icon: Tag, title: 'Promotions',
    desc: 'Fill slow days on demand — create promo codes with percent or peso discounts, usage caps, and expiry dates.',
    detail: 'Codes validate at checkout in one tap, with per-customer limits and expiry dates doing the guarding.',
  },
  {
    icon: CheckCircle2, title: 'Bookings & Returns',
    desc: 'Process new rentals, scan QR codes, and handle returns — damaged pieces go Out of Service automatically.',
    detail: 'No-shows and overdue rentals are flagged automatically so you can follow up.',
  },
  {
    icon: Sparkles, title: 'Reports',
    desc: 'Reports turns real transaction data into business reports, forecasts, and suggestions.',
    detail: 'Top items, revenue trends, and next-month demand — every peso figure is checked against real data before it shows.',
  },
  {
    icon: Settings, title: 'Settings',
    desc: 'Settings is your control room — rental rules and fees, promo codes, SMS templates, and integrations.',
    detail: 'Set rental rules and fees, create promo codes, edit SMS templates, manage staff accounts, and secure sign-in with MFA (two-factor).',
  },
];

const stepNumbers = ['01', '02', '03', '04', '05', '06', '07'];

// Opening welcome screen. greeting uses the account's full name when known.
const welcomeStep = (roleKey, fullName) => ({
  logo: true,
  title: fullName ? `Welcome, ${fullName}!` : 'Welcome to RenTech',
  desc:
    roleKey === 'customer'
      ? 'Your boutique for gowns, suits, and formal wear rentals across Batangas.'
      : roleKey === 'admin'
        ? 'Your command center for inventory, bookings, reports, and settings.'
        : 'Everything you need to run daily rentals — bookings, tasks, and returns.',
  detail: 'This quick tour takes under a minute. Use Next and Back, or Skip any time.',
});

// One storage key per role so staff/admin/customer tutorials are independent.
const storageKeyFor = (role) => {
  const r = (role || '').toLowerCase();
  return r === 'customer' ? 'onboardingDone_Customer' : r === 'admin' ? 'onboardingDone_Admin' : 'onboardingDone_Staff';
};

export default function OnboardingTutorial({ role, displayName, onComplete }) {
  const [step, setStep] = useState(0);
  // Slide direction for the content transition: +1 = Next (slides in from
  // the right), -1 = Back (slides in from the left).
  const [dir, setDir] = useState(1);
  const roleKey = (role || '').toLowerCase();
  const roleSteps = roleKey === 'customer' ? customerSteps : roleKey === 'admin' ? adminSteps : staffSteps;
  const fullName = String(displayName || '').trim();
  const steps = [welcomeStep(roleKey, fullName), ...roleSteps];
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

  // Swipeable slides: horizontal swipe moves, vertical drift stays a scroll.
  const swipeRef = useRef({ startX: 0, startY: 0 });
  const onSwipeStart = (e) => {
    if (e.touches.length !== 1) return;
    swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY };
  };
  const onSwipeEnd = (e) => {
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - swipeRef.current.startX;
    const dy = e.changedTouches[0].clientY - swipeRef.current.startY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 50) return;
    if (dx < 0) handleNext();
    else handlePrev();
  };

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
              className="absolute inset-y-0 left-0 transition-all duration-300 ease-out bg-[#bf4a53]"
              style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
            />
          </div>

          {/* Step number badge + skip (clear escape hatch) */}
          <div className="flex items-center justify-between px-6 pt-4">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-[#bf4a53]" />
              Step {stepNumbers[step]} of {totalSteps}
            </span>
            <button
              onClick={finish}
              className="min-h-[44px] px-2 -mr-1 text-xs font-bold text-gray-400 hover:text-gray-600 active:text-gray-700 transition-colors shrink-0"
            >
              Skip
            </button>
          </div>

          <div
            className="p-6 pt-4 sm:p-7 sm:pt-4 overflow-y-auto min-h-0"
            onTouchStart={onSwipeStart}
            onTouchEnd={onSwipeEnd}
          >
            {/* Step body: the ONLY remounting part. Short directional slide
                (no zoom, no backdrop flash) keeps Next/Back buttery. */}
            <div
              key={step}
              aria-live="polite"
              className={`animate-in fade-in duration-200 ${dir >= 0 ? 'slide-in-from-right-4' : 'slide-in-from-left-4'}`}
            >
            {card.logo ? (
              <div className="flex flex-col items-center text-center px-2">
                <img src="/RenTech.png" alt="RenTech" className="w-14 h-14 rounded-2xl shadow-lg shadow-red-500/20" />
                <h3 className="font-extrabold text-xl text-gray-900 leading-snug mt-3">{card.title}</h3>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-xs">{card.desc}</p>
              </div>
            ) : (
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-2xl shrink-0 bg-[#bf4a53]/10 text-[#bf4a53]">
                  <Icon size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg text-gray-900">{card.title}</h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{card.desc}</p>
                </div>
              </div>
            )}

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
                  {step === 0 ? <>Get Started <ChevronRight size={14} /></> : step < totalSteps - 1 ? <>Next <ChevronRight size={14} /></> : 'Done'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
