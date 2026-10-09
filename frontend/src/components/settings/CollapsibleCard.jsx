import { useState, useId } from 'react';
import { ChevronDown } from 'lucide-react';

// Shared collapsible settings card (mobile + desktop).
//
// - Header is a full-width button (44px+ touch target, keyboard accessible)
//   with the icon tile, title, subtitle, optional badge, and a chevron that
//   rotates on expand. Subtitle truncates on small screens so the badge and
//   chevron never get pushed out; it wraps fully on sm+.
// - Body animates open/closed via the grid-rows trick (no fixed heights, so
//   any content length works on any screen size).
// - Uncontrolled by default with the open state persisted to localStorage
//   under `storageKey`. Pass `open` + `onOpenChange` for controlled usage
//   (e.g. Change Password, which hides its form on success).
export default function CollapsibleCard({
  icon: Icon,
  media,
  title,
  subtitle,
  badge,
  storageKey,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  children,
}) {
  const bodyId = useId();
  const [uncontrolled, setUncontrolled] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === null ? defaultOpen : saved === '1';
    } catch {
      return defaultOpen;
    }
  });

  const open = controlledOpen ?? uncontrolled;
  const setOpen = (next) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (controlledOpen === undefined) {
      setUncontrolled(value);
      if (storageKey) {
        try { localStorage.setItem(storageKey, value ? '1' : '0'); } catch { /* private mode */ }
      }
    }
    if (onOpenChange) onOpenChange(value);
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-center gap-3 px-4 sm:px-5 md:px-8 py-4 min-h-[72px] text-left bg-gradient-to-r from-[#bf4a53]/10 via-rose-50 to-transparent hover:from-[#bf4a53]/15 active:from-[#bf4a53]/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/50"
      >
        {media ?? (
          <span className="w-10 h-10 rounded-2xl bg-[#bf4a53] text-white flex items-center justify-center shadow-sm shadow-red-500/20 shrink-0">
            {Icon && <Icon size={18} />}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-gray-900 text-[15px] md:text-base leading-tight">{title}</span>
          {subtitle && (
            <span className="block text-xs text-gray-500 font-medium mt-0.5 truncate sm:whitespace-normal">
              {subtitle}
            </span>
          )}
        </span>
        {badge && <span className="shrink-0 hidden min-[400px]:inline-flex">{badge}</span>}
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={`shrink-0 text-gray-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        id={bodyId}
        role="region"
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          open ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="px-4 sm:px-5 md:px-8 pb-5 md:pb-6 pt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
