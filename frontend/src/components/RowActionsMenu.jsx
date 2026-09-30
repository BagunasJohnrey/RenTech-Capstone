import { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { useEscapeClose } from '../hooks/useEscapeClose';

// Overflow ("⋯") menu for crowded table/card action clusters. The popup is
// portaled to <body> and positioned fixed from the trigger's viewport rect,
// so it can never be clipped by the table's horizontal scroller or a
// transformed ancestor.
//
// Mobile notes (this menu was previously untappable on touch):
// - Rows activate on plain onClick. The old pointerdown/pointerup scheme died
//   whenever the finger slid even slightly (pointerup lands off-row) or the
//   browser took over the gesture (pointercancel on scroll) — onClick handles
//   touch slop correctly and fires for mouse/keyboard too.
// - Scroll/resize REPOSITIONS the popup instead of closing it. The old
//   close-on-scroll unmounted the menu between pointerdown and click on taps
//   that caused even a micro-scroll (touch slop, momentum, address-bar
//   hide), so the tap landed on a removed element and looked "dead". The menu
//   only closes once its trigger scrolls fully out of the viewport.
// - `touch-manipulation` removes the double-tap-zoom delay and 44px-min rows
//   meet touch-target guidance.
//
// items: [{ key, icon: LucideIcon, label, href?, onSelect?, danger?, tone? }]
//   - href → rendered as <a> (e.g. tel: links, native navigation); otherwise
//     a <button>.
//   - danger → red row (delete/cancel); tone → icon color class override.
export default function RowActionsMenu({ items = [], label = 'More actions', buttonClassName = 'p-1.5 text-gray-500 hover:bg-gray-100 rounded-full transition-colors', iconSize = 15 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEscapeClose(() => setOpen(false), open);

  const computePos = useCallback(() => {
    const btn = btnRef.current?.getBoundingClientRect();
    if (!btn) return null;
    const menuW = 208; // w-52
    const menuH = menuRef.current?.offsetHeight || items.length * 44 + 12;
    const below = btn.bottom + 8 + menuH <= window.innerHeight;
    return {
      top: below ? btn.bottom + 6 : Math.max(8, btn.top - menuH - 6),
      left: Math.max(8, Math.min(btn.right - menuW, window.innerWidth - menuW - 8)),
    };
  }, [items.length]);

  // Position after mount (layout effect = before paint, no flash): below the
  // button, right-aligned; flips above when near the viewport bottom.
  useLayoutEffect(() => {
    if (!open) return;
    const p = computePos();
    if (p) setPos(p);
  }, [open, computePos]);

  useEffect(() => {
    if (!open) return;
    // Outside taps use pointerdown-capture (NOT a covering backdrop div): a
    // backdrop would swallow the tap on ANOTHER row's ⋯ button, forcing a
    // double-tap to switch rows. Capture runs before the other button's click,
    // so this menu closes and the new one opens in a single tap. Refs work
    // across the portal — .contains() checks the real DOM nodes.
    const onPointerDown = (e) => {
      const t = e.target;
      const inside =
        (btnRef.current && btnRef.current.contains(t)) ||
        (menuRef.current && menuRef.current.contains(t));
      if (!inside) setOpen(false);
    };
    // Stick the popup to its trigger while the page scrolls; only give up
    // once the trigger itself leaves the viewport. Never unmount mid-tap.
    const onScrollOrResize = () => {
      const btn = btnRef.current?.getBoundingClientRect();
      if (!btn || btn.bottom < 0 || btn.top > window.innerHeight || btn.right < 0 || btn.left > window.innerWidth) {
        setOpen(false);
        return;
      }
      const p = computePos();
      if (p) setPos(p);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, computePos]);

  if (items.length === 0) return null;

  const fire = (item) => {
    setOpen(false);
    if (item.href) return; // anchor navigates natively
    item.onSelect?.();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`${buttonClassName} touch-manipulation [-webkit-tap-highlight-color:transparent]`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={iconSize} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-[201] w-52 max-h-[70dvh] overflow-y-auto bg-white rounded-2xl border border-gray-100 shadow-xl py-1.5 animate-in fade-in zoom-in-95 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => {
            const Icon = item.icon;
            const rowClass = `flex items-center gap-2.5 w-full px-3.5 py-2.5 min-h-[44px] text-[13px] font-semibold transition-colors text-left select-none touch-manipulation [-webkit-tap-highlight-color:transparent] ${
              item.danger ? 'text-red-600 hover:bg-red-50 active:bg-red-100' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'
            }`;
            const iconClass = item.danger ? 'text-red-500 shrink-0' : `${item.tone || 'text-gray-400'} shrink-0`;
            if (item.href) {
              return (
                <a
                  key={item.key}
                  href={item.href}
                  role="menuitem"
                  className={rowClass}
                  onClick={() => setOpen(false)}
                >
                  {Icon && <Icon size={15} className={iconClass} />}
                  {item.label}
                </a>
              );
            }
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={rowClass}
                onClick={(e) => { e.stopPropagation(); fire(item); }}
              >
                {Icon && <Icon size={15} className={iconClass} />}
                {item.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
