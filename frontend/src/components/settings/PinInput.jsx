import { useRef } from 'react';

// 4-box digit PIN input: numeric-only, auto-advance, backspace navigates back,
// digits masked like a password field. Used in the admin discount PIN forms.
export default function PinInput({ value = '', onChange, autoFocus = false, onEnter, boxClass = '' }) {
  const refs = useRef([]);

  const handleChange = (i, v) => {
    const digit = v.replace(/\D/g, '').slice(-1);
    const next = (value.slice(0, i) + digit + value.slice(i + 1)).slice(0, 4);
    onChange(next);
    if (digit && i < 3) {
      refs.current[i + 1]?.focus();
    } else if (digit && i === 3) {
      onEnter?.();
    }
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < 3) {
      refs.current[i + 1]?.focus();
    } else if (e.key === 'Enter') {
      onEnter?.();
    }
  };

  return (
    <div className={`flex gap-2 justify-center ${boxClass}`}>
      {[0, 1, 2, 3].map((i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="password"
          inputMode="numeric"
          value={value[i] || ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          autoFocus={autoFocus && i === 0}
          maxLength={2}
          aria-label={`PIN digit ${i + 1}`}
          className="w-12 h-12 bg-gray-50 rounded-xl border text-center text-2xl font-bold text-gray-900 focus:outline-none focus:bg-white focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15"
        />
      ))}
    </div>
  );
}
