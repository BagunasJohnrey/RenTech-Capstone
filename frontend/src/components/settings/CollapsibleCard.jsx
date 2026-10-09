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
// - Optional `headerAction` (Edit buttons, Refresh, toggles) renders BESIDE
//   the toggle button — never nested inside it — so interactive headers stay
//   valid HTML and a click on the action never toggles the collapse.
// - Optional `iconClass` recolors the icon tile (admin cards use varied tiles).
// - Uncontrolled by default with the open state persisted to localStorage
//   under `storageKey` (persistence also applies in controlled mode when a
//   `storageKey` is given). Pass `open` + `onOpenChange` for controlled usage
//   (e.g. Change Password, which hides its form on success).
export default function CollapsibleCard({
  icon: Icon,
  media,
  iconClass,
  title,
  subtitle,
  badge,
  headerAction,
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
  const persist = (value) => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, value ? '1' : '0'); } catch { /* private mode */ }
  };
  const setOpen = (next) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (controlledOpen === undefined) {
      setUncontrolled(value);
    }
    persist(value);
    if (onOpenChange) onOpenChange(value);
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm overflow-hidden">
      <div className="flex items-center gap-1 sm:gap-2 bg-gradient-to-r from-[#bf4a53]/10 via-rose-50 to-transparent">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex-1 flex items-center gap-3 pl-4 sm:pl-5 md:pl-8 pr-1 sm:pr-2 py-4 min-h-[72px] text-left hover:bg-[#bf4a53]/5 active:bg-[#bf4a53]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/50"
        >
          {media ?? (
            <span className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm shrink-0 ${iconClass ?? 'bg-[#bf4a53] text-white shadow-red-500/20'}`}>
              {Icon && <Icon size={18} />}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-gray-900 text-[15px] md:text-base leading-tight">{title}</span>
            {subtitle && (
              <span className="block text-xs text-gray-500 font-medium mt-0.5 line-clamp-2">
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
        {headerAction && (
          <div className="shrink-0 pr-4 sm:pr-5 md:pr-8 py-2">{headerAction}</div>
        )}
      </div>

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
