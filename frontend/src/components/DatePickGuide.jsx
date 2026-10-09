import { MousePointerClick, PartyPopper, Undo2, Check } from 'lucide-react';

// 3-step "how to pick dates" guide shared by the customer booking flow and
// the staff walk-in flow. Highlights the current step live: pick a pickup
// day (turns red) → pick the event day (turns green) → return is automatic.
// `returnLabel` is the human due date once the event day is known.
// Step themes follow the calendar legend: pickup = red, event = green,
// return = amber. Active and done states both wear the theme color; only
// upcoming steps stay grey.
const THEMES = {
  red: { solid: 'bg-[#bf4a53] text-white', soft: 'bg-red-50/60 border-[#bf4a53]/40', dot: 'bg-[#bf4a53]' },
  green: { solid: 'bg-emerald-500 text-white', soft: 'bg-emerald-50/60 border-emerald-300/70', dot: 'bg-emerald-500' },
  amber: { solid: 'bg-amber-500 text-white', soft: 'bg-amber-50/70 border-amber-300/80', dot: 'bg-amber-500' },
};

export default function DatePickGuide({ hasPickup, hasEvent, returnLabel }) {
  const steps = [
    {
      icon: MousePointerClick,
      theme: THEMES.red,
      title: 'Tap pickup day',
      desc: 'Any open day — it turns red.',
      state: !hasPickup ? 'active' : 'done',
    },
    {
      icon: PartyPopper,
      theme: THEMES.green,
      title: 'Tap event day',
      desc: 'Your big day — it turns green.',
      state: !hasPickup ? 'todo' : !hasEvent ? 'active' : 'done',
    },
    {
      icon: Undo2,
      theme: THEMES.amber,
      title: 'Return is automatic',
      desc: returnLabel ? `Due ${returnLabel}.` : 'No tap needed.',
      state: hasPickup && hasEvent ? 'done' : 'todo',
    },
  ];

  return (
    <ol className="grid gap-2 sm:grid-cols-3" aria-label="How to pick rental dates">
      {steps.map(({ icon: Icon, theme, title, desc, state }, i) => (
        <li
          key={title}
          aria-current={state === 'active' ? 'step' : undefined}
          className={`flex items-center gap-2.5 p-3 rounded-2xl border transition-colors ${
            state === 'todo' ? 'bg-[#fafafa] border-gray-100' : theme.soft
          }`}
        >
          <span
            aria-hidden="true"
            className={`relative shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${
              state === 'todo' ? 'bg-white border border-gray-200 text-gray-400' : theme.solid
            }`}
          >
            {state === 'done' ? <Check size={15} strokeWidth={3} /> : <Icon size={15} />}
            {state === 'active' && (
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white animate-pulse ${theme.dot}`} />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-extrabold text-gray-900">
              <span className="text-gray-400 font-bold mr-1">{i + 1}</span>
              {title}
            </span>
            <span className="block text-[11px] text-gray-500 mt-0.5 leading-snug">{desc}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
