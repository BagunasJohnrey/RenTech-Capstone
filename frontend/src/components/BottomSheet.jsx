import { useState, useRef, useCallback, useEffect } from 'react';

// Module-level body lock (ref-counted): while ANY sheet is open the page
// behind must not scroll — otherwise a downward drag chains through to the
// body and fires the browser's pull-to-refresh instead of moving the sheet.
let bodyLockCount = 0;
function lockBody() {
  bodyLockCount += 1;
  if (bodyLockCount === 1 && typeof document !== 'undefined') {
    document.body.dataset.rentechSheetLock = '1';
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
  }
}
function unlockBody() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0 && typeof document !== 'undefined' && document.body.dataset.rentechSheetLock) {
    delete document.body.dataset.rentechSheetLock;
    document.body.style.overflow = '';
    document.body.style.overscrollBehavior = '';
  }
}

// Shared sheet shell. Phones: bottom-anchored (rounded top, full width,
// swipe-down-to-dismiss). Small tablets (sm): centered card. Desktop (md+):
// `variant="panel"` (default) is a full-height panel docked to the right edge;
// `variant="dialog"` stays a centered card — use it for small confirms and
// pickers. Every modal shares this treatment so they all behave the same.
// Scrollable bodies inside should carry `data-sheet-scroll` so a downward
// drag that starts mid-scroll stays a scroll instead of dismissing.
// `backdropClass` lets a sheet stacked on another skip the second blur
// (two stacked backdrop blurs jank low-end phones).
// Desktop side-panel width for each sheet size (literal classes for
// Tailwind). Wider than the phone/tablet card on purpose: desktop has room.
// `panelWidth` overrides this for sheets with their own desktop layout.
// `columns` is for sheets whose body uses `.panel-cols` (two balanced
// columns at lg+, see index.css): the panel widens to fit them.
const PANEL_WIDTH = {
  'sm:max-w-sm': 'md:w-[440px]',
  'sm:max-w-md': 'md:w-[520px]',
  'sm:max-w-lg': 'md:w-[560px] lg:w-[620px]',
  'sm:max-w-xl': 'md:w-[620px] lg:w-[680px]',
  'sm:max-w-2xl': 'md:w-[680px] lg:w-[760px]',
  'sm:max-w-3xl': 'md:w-[720px] lg:w-[880px]',
};

export default function BottomSheet({ onClose, labelledby, z = 'z-[200]', maxWidth = 'sm:max-w-lg', variant = 'panel', panelWidth, columns = false, interceptClose = false, hideHandle = false, backdropClass = 'bg-gray-900/40 backdrop-blur-sm', children }) {
  const isPanel = variant === 'panel';
  const [dragY, setDragY] = useState(null);
  const [dismissing, setDismissing] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const sheetRef = useRef(null);
  const dragState = useRef({ startY: 0, lastY: 0, lastT: 0, active: false, atTop: true });

  // Hold the body lock for our whole lifetime (stack-safe via ref-count).
  useEffect(() => { lockBody(); return () => unlockBody(); }, []);

  const dismissWithAnimation = useCallback(() => {
    // Same guard as backdrop-tap: a guarded parent (unsaved changes)
    // keeps the sheet put and decides (confirm dialog) instead.
    if (interceptClose) { setDragY(null); onClose(); return; }
    closingRef.current = true;
    setDismissing(true);
    setDragY(null);
    setTimeout(onClose, 190);
  }, [interceptClose, onClose]);

  const requestClose = useCallback(() => {
    if (closing || closingRef.current) return;
    // Guarded flows (e.g. an unsaved-changes confirm): skip the exit
    // animation and hand control straight to the parent. Animating first
    // would slide the sheet away underneath the confirm dialog, so "Keep
    // Editing" would return to an invisible sheet that looks like lost work.
    // No flags are set here — the sheet stays fully interactive.
    if (interceptClose) { onClose(); return; }
    closingRef.current = true;
    setDragY(null);
    setClosing(true);
    setTimeout(onClose, 150);
  }, [closing, onClose, interceptClose]);

  const onSheetTouchStart = (e) => {
    if (dismissing || closingRef.current || e.touches.length !== 1) return;
    // Every enclosing scroller must be at the top — not just the nearest.
    // (A scrolled inner list, e.g. blocked dates, must keep its own scroll
    // instead of turning into a sheet dismiss.)
    let atTop = true;
    let el = e.target?.closest?.('[data-sheet-scroll]');
    while (el) {
      if (el.scrollTop > 0) { atTop = false; break; }
      el = el.parentElement?.closest?.('[data-sheet-scroll]');
    }
    dragState.current = {
      startY: e.touches[0].clientY,
      lastY: e.touches[0].clientY,
      lastT: performance.now(),
      active: false,
      // Latch at gesture START: a scroll that merely arrives at the top
      // mid-gesture must never turn into a dismiss.
      atTop,
    };
  };
  const onSheetTouchMove = (e) => {
    const s = dragState.current;
    if (e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - s.startY;
    if (!s.active) {
      if (!s.atTop) return;
      if (dy < 10) return;
      s.active = true;
    }
    if (dy <= 0) { setDragY(null); return; } // finger back up: ease home, don't jump
    s.lastY = e.touches[0].clientY;
    s.lastT = performance.now();
    setDragY(dy);
  };
  const onSheetTouchEnd = (e) => {
    const s = dragState.current;
    s.active = false;
    if (closingRef.current) return;
    const endY = e.changedTouches[0].clientY;
    const endT = performance.now();
    const dy = Math.max(0, endY - s.startY);
    // Deliberate long drag only: ~45% of the sheet height (min 180px).
    const threshold = Math.max(180, (sheetRef.current?.offsetHeight ?? 600) * 0.45);
    // …or a fast downward flick: short travel but high velocity. A downward
    // swipe that starts at the top can't scroll anything (nothing above),
    // so hijacking it for dismiss is safe and matches native sheets.
    const dt = Math.max(1, endT - s.lastT);
    const velocity = (endY - s.lastY) / dt; // px per ms, downward positive
    const flicked = s.atTop && dy >= 60 && velocity > 0.6;
    if (dy >= threshold || flicked) {
      dismissWithAnimation();
      return;
    }
    setDragY(null); // snap back (transition animates it)
  };

  return (
    <div className={`fixed inset-0 ${z} transition-opacity duration-150 ${closing || dismissing ? 'opacity-0' : 'opacity-100'}`}
      style={dragY != null && !dismissing ? { opacity: Math.max(0.25, 1 - dragY / 500) } : undefined}
    >
      <div className={`fixed inset-0 ${backdropClass}`} onClick={requestClose} />
      <div className={`fixed inset-0 flex items-end sm:items-center justify-center px-0 pt-10 pb-0 sm:p-4 pointer-events-none ${isPanel ? 'md:items-stretch md:justify-end md:p-0' : ''}`}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledby}
          ref={sheetRef}
          onTouchStart={onSheetTouchStart}
          onTouchMove={onSheetTouchMove}
          onTouchEnd={onSheetTouchEnd}
          onClick={(e) => e.stopPropagation()}
          className={`relative bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full ${maxWidth} sheet-cap sm:max-h-[90vh] flex flex-col overflow-hidden overscroll-contain pointer-events-auto transform-gpu sheet-enter ${isPanel ? `sheet-panel md:h-full md:max-h-none md:max-w-[92vw] md:rounded-r-none ${panelWidth || (columns ? 'md:w-[640px] lg:w-[min(960px,94vw)]' : PANEL_WIDTH[maxWidth]) || 'md:w-[560px] lg:w-[620px]'}` : ''}`}
          style={
            dismissing
              ? { transform: 'translateY(105%)', transition: 'transform 190ms ease-in' }
              : dragY != null
                ? { transform: `translateY(${dragY}px)`, transition: 'none' }
                : undefined
          }
        >
          {!hideHandle && (
            <div className="sm:hidden pt-2 pb-0 flex justify-center shrink-0" aria-hidden="true">
              <div className="w-10 h-1 rounded-full bg-gray-200" />
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
