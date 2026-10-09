import { useId } from 'react';

const DEFAULT_INPUT_CLASS =
  'w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-all';

// A labeled form field: auto-generates the id (and matching <label htmlFor>),
// links aria-describedby to the error message, and forwards any other aria-*
// props to the input. Keeps the existing input styling unless overridden.
export default function Field({
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  required = false,
  disabled = false,
  autoComplete,
  inputMode,
  className = DEFAULT_INPUT_CLASS,
  labelClassName = 'block text-[11px] font-bold text-gray-500 uppercase tracking-wide',
  wrapClassName = '',
  showLabel = true,
  children,
  endAccessory, // optional node absolutely anchored to the input's right edge (e.g. show/hide password toggle)
  ...rest
}) {
  const uid = useId();
  const id = `field-${uid.replace(/[^a-zA-Z0-9_]/g, '')}`;
  const errId = error ? `${id}-error` : undefined;
  return (
    <div className={wrapClassName}>
      {showLabel && label != null && label !== '' ? (
        <label htmlFor={id} className={labelClassName}>
          {label}
          {/* Required marker only while the field still needs input — once
              it holds a value the asterisk goes away (the error message, if
              any, takes over). */}
          {required && String(value ?? '').trim() === '' ? (
            <span aria-hidden="true" className="text-[#bf4a53] ml-0.5">*</span>
          ) : null}
        </label>
      ) : null}
      <div className={`relative ${label != null && label !== '' && showLabel ? 'mt-1.5' : ''}`}>
        {children /* optional custom content replacing the input */}
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={errId}
          className={className}
          {...rest}
        />
        {endAccessory}
      </div>
      {error ? (
        <p id={errId} role="alert" className="text-[11px] text-red-500 font-medium mt-1 ml-1">
          {error}
        </p>
      ) : null}
    </div>
  );
}
