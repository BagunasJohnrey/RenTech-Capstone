import { useState, useRef, useCallback } from 'react';

// Shared bottom-sheet shell: bottom-anchored on mobile (rounded top, full
// width, swipe-down-to-dismiss), centered card on sm+ screens. Mirrors the
// TransactionDetailModal treatment so every modal behaves the same.
// Scrollable bodies inside should carry `data-sheet-scroll` so a downward
// drag that starts mid-scroll stays a scroll instead of dismissing.
export default function BottomSheet({ onClose, labelledby, z = 'z-[200]', maxWidth = 'sm:max-w-lg', children }) {
  const [dragY, setDragY] = useState(null);
  const [dismissing, setDismissing] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const sheetRef = useRef(null);
  const dragState = useRef({ startY: 0, active: false, atTop: true });

  const requestClose = useCallback(() => {
    if (closing || closingRef.current) return;
    closingRef.current = true;
    setDragY(null);
    setClosing(true);
    setTimeout(onClose, 150);
  }, [closing, onClose]);

  const onSheetTouchStart = (e) => {
    if (dismissing || closingRef.current || e.touches.length !== 1) return;
    const scroller = e.target?.closest?.('[data-sheet-scroll]');
    dragState.current = {
      startY: e.touches[0].clientY,
      active: false,
      // Latch whether the gesture STARTED at the top: a scroll that merely
      // arrives at the top mid-gesture must never turn into a dismiss.
      atTop: !scroller || scroller.scrollTop <= 0,
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
    setDragY(dy);
  };
  const onSheetTouchEnd = (e) => {
    const s = dragState.current;
    s.active = false;
    if (closingRef.current) return;
    const endY = e.changedTouches[0].clientY;
    const dy = Math.max(0, endY - s.startY);
    // Deliberate long drag only: ~45% of the sheet height (min 180px). Fast
    // flicks no longer dismiss on velocity — the swipe must truly reach.
    const threshold = Math.max(180, (sheetRef.current?.offsetHeight ?? 600) * 0.45);
    if (dy >= threshold) {
      closingRef.current = true;
      setDismissing(true);
      setDragY(null);
      setTimeout(onClose, 190);
      return;
    }
    setDragY(null); // snap back (transition animates it)
  };

  return (
    <div className={`fixed inset-0 ${z} transition-opacity duration-150 ${closing || dismissing ? 'opacity-0' : 'opacity-100'}`}
      style={dragY != null && !dismissing ? { opacity: Math.max(0.25, 1 - dragY / 500) } : undefined}
    >
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={requestClose} />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center px-0 pt-10 pb-0 sm:p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledby}
          ref={sheetRef}
          onTouchStart={onSheetTouchStart}
          onTouchMove={onSheetTouchMove}
          onTouchEnd={onSheetTouchEnd}
          onClick={(e) => e.stopPropagation()}
          className={`relative bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full ${maxWidth} sheet-cap sm:max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto transform-gpu animate-in slide-in-from-bottom sm:zoom-in-95 duration-200`}
          style={
            dismissing
              ? { transform: 'translateY(105%)', transition: 'transform 190ms ease-in' }
              : dragY != null
                ? { transform: `translateY(${dragY}px)`, transition: 'none' }
                : undefined
          }
        >
          <div className="sm:hidden pt-2 pb-0 flex justify-center shrink-0" aria-hidden="true">
            <div className="w-10 h-1 rounded-full bg-gray-200" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
