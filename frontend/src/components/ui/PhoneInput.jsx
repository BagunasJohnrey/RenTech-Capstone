import { INPUT_LIMITS, phoneLocalDigits, phoneFromLocalInput } from '../../utils/inputLimits';

// PH mobile input: a fixed "+63" prefix and a 10-digit box (9XXXXXXXXX). `value` and the
// `onChange` event's target.value stay in the stored 09XXXXXXXXX form, so
// callers keep their existing state + sanitizePhone handlers. Pasting a full
// number (0917…, +63917…) fills the box correctly.
export default function PhoneInput({ value, onChange, className = '', style, placeholder = '9171234567', ...rest }) {
  const handleChange = (e) => {
    onChange?.({ target: { value: phoneFromLocalInput(e.target.value) }, currentTarget: e.currentTarget });
  };
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 select-none"
      >
        {INPUT_LIMITS.PHONE_PREFIX}
      </span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        {...rest}
        // Room for a pasted full number (with spaces/+); trimmed to 10 digits.
        maxLength={16}
        value={phoneLocalDigits(value)}
        onChange={handleChange}
        placeholder={placeholder}
        className={className}
        style={{ ...style, paddingLeft: '2.75rem' }}
      />
    </div>
  );
}
