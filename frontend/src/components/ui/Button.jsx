// Shared action buttons. One height per size and one look per variant so
// sibling modals (Release, Return, Approve proof, SMS) stop drifting apart.

// Filled buttons go flat gray when disabled (the existing modal convention)
// instead of a faded brand color that still reads as tappable.
const FILLED_DISABLED = 'disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none';

const VARIANTS = {
  primary: `bg-[#bf4a53] text-white hover:bg-[#a83d46] shadow-sm ${FILLED_DISABLED}`,
  success: `bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm ${FILLED_DISABLED}`,
  info: `bg-blue-600 text-white hover:bg-blue-700 shadow-sm ${FILLED_DISABLED}`,
  danger: `bg-red-600 text-white hover:bg-red-700 shadow-sm ${FILLED_DISABLED}`,
  secondary: 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50',
  ghost: 'text-gray-600 hover:bg-gray-100 disabled:opacity-50',
};

const SIZES = {
  sm: 'h-9 px-3.5 text-xs gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-12 px-5 text-sm gap-2', // modal footers
};

const BASE =
  'inline-flex items-center justify-center rounded-2xl font-bold transition-colors active:scale-[0.98] ' +
  'disabled:cursor-not-allowed disabled:active:scale-100 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus-visible:ring-offset-1';

export default function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

const ICON_TONES = {
  neutral: 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
  brand: 'text-[#bf4a53] bg-white shadow-sm hover:bg-[#bf4a53] hover:text-white',
  danger: 'text-gray-400 hover:bg-red-50 hover:text-red-600',
};

// Icon-only button: `label` is required (becomes aria-label + tooltip) and the
// hit area is always >= 40x40 even when the glyph is small.
export function IconButton({
  label,
  tone = 'neutral',
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 ${ICON_TONES[tone] || ICON_TONES.neutral} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
