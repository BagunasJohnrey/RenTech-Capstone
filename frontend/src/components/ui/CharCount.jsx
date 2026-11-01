// Small "12/50" counter for capped text inputs. Turns amber near the cap.
export default function CharCount({ value, max, className = '' }) {
  const len = String(value ?? '').length;
  const near = len >= max * 0.9;
  return (
    <p aria-live="polite" className={`text-right text-[10px] font-medium tabular-nums mt-1 ${near ? 'text-amber-600' : 'text-gray-400'} ${className}`}>
      {len}/{max}
    </p>
  );
}
