import { useState, useCallback } from 'react';
import { ShoppingBag, ChevronRight, ChevronLeft, Search, Calendar, User, X, CheckCircle2, CreditCard as PayIcon, FileText } from 'lucide-react';

const customerSteps = [
  {
    icon: Search, title: 'Browse the Collection',
    desc: 'Explore gowns, suits, and formal wear available for rent. Tap any item to see details and check availability.',
    detail: 'Available items show a "Rent Now" button. Unavailable items are marked.',
  },
  {
    icon: Calendar, title: 'Select Dates & Book',
    desc: 'Choose your pickup date and event date. The item must be picked up before your event.',
    detail: 'Return is due the day after your event. A 50% downpayment secures your booking.',
  },
  {
    icon: User, title: 'Enter Your Details',
    desc: 'Fill in your name, contact number, and address. Select your size or enter custom measurements.',
    detail: 'You can book for yourself or someone else. Add special notes if needed.',
  },
  {
    icon: PayIcon, title: 'Confirm & Pay',
    desc: 'Review your booking summary and pay the downpayment via GCash or card.',
    detail: 'After payment, you will receive a booking confirmation with your transaction ID and QR code.',
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
    detail: 'Return date is auto-calculated (event date + 1 day). Optional: downpayment, notes, and condition photo.',
  },
  {
    icon: FileText, title: 'Review & Confirm',
    desc: 'Check the booking summary — customer, dates, item, and pricing.',
    detail: 'Tap "Confirm & Process" to create the rental. A confirmation toast will appear.',
  },
  {
    icon: CheckCircle2, title: 'Rental Created',
    desc: 'The rental is now active. The item status changes to Reserved.',
    detail: 'You can view it in Transactions and process the return when the item comes back.',
  },
];

const stepColors = [
  'bg-blue-50 text-blue-600',
  'bg-emerald-50 text-emerald-600',
  'bg-orange-50 text-orange-600',
  'bg-purple-50 text-purple-600',
];

const stepNumbers = ['01', '02', '03', '04'];

export default function OnboardingTutorial({ role, onComplete }) {
  const [step, setStep] = useState(0);
  const isCustomer = role?.toLowerCase() === 'customer';
  const steps = isCustomer ? customerSteps : staffSteps;
  const storageKey = isCustomer ? 'onboardingDone_Customer' : 'onboardingDone';
  const card = steps[step];
  const Icon = card.icon;

  const finish = useCallback(() => {
    localStorage.setItem(storageKey, 'true');
    onComplete();
  }, [storageKey, onComplete]);

  const handleNext = () => {
    if (step < steps.length - 1) setStep(s => s + 1);
    else finish();
  };

  const handlePrev = () => {
    if (step > 0) setStep(s => s - 1);
  };

  const totalSteps = steps.length;

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-gray-900/60" onClick={finish} />

      <div
        key={step}
        className="relative w-full sm:max-w-md animate-in fade-in zoom-in-95 duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Step number badge */}
        <div className="flex justify-center mb-2 sm:mb-0">
          <div className="bg-white/20 backdrop-blur-md text-white text-[10px] font-bold px-3 py-1 rounded-full">
            Step {stepNumbers[step]} of {totalSteps}
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-100/80 overflow-hidden">
          {/* Colored accent bar */}
          <div className={`h-1.5 ${step === 0 ? 'bg-blue-500' : step === 1 ? 'bg-emerald-500' : step === 2 ? 'bg-orange-500' : 'bg-purple-500'}`} />

          <div className="p-6 sm:p-7">
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-2xl shrink-0 ${stepColors[step]}`}>
                <Icon size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg text-gray-900">{card.title}</h3>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">{card.desc}</p>
              </div>
              <button onClick={finish} className="p-1 text-gray-300 hover:text-gray-500 transition-colors shrink-0">
                <X size={16} />
              </button>
            </div>

            {/* Extra detail box */}
            <div className="mt-4 bg-gray-50 rounded-xl p-3.5 border border-gray-100/60">
              <div className="flex items-start gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#bf4a53] mt-1.5 shrink-0" />
                <p className="text-xs text-gray-500 leading-relaxed">{card.detail}</p>
              </div>
            </div>

            {/* Progress & navigation */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
              <div className="flex gap-2">
                {steps.map((_, i) => (
                  <div key={i} className={`h-1 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-[#bf4a53]' : 'w-2 bg-gray-200'}`} />
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
                      ? 'bg-[#bf4a53] text-white hover:bg-red-700'
                      : 'bg-gray-900 text-white hover:bg-gray-800'
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
