import { useEffect } from 'react';

// Locks background scrolling while a modal is open. The app shell scrolls an
// inner div (#app-scroll — the window itself is fixed-height), so locking
// only body overflow would do nothing. Reference-counted so nested modals
// (e.g. the pay form over the detail sheet) can't unlock early: the
// background stays frozen until the last modal unmounts, and the backdrop
// remains purely a tap-to-close target.
let locks = 0;
let prev = null;

function lock() {
  if (locks === 0) {
    const scroller = document.getElementById('app-scroll');
    prev = {
      html: document.documentElement.style.overflow,
      body: document.body.style.overflow,
      app: scroller ? scroller.style.overflow : null,
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (scroller) scroller.style.overflow = 'hidden';
  }
  locks += 1;
}

function unlock() {
  locks = Math.max(0, locks - 1);
  if (locks === 0 && prev) {
    document.documentElement.style.overflow = prev.html;
    document.body.style.overflow = prev.body;
    const scroller = document.getElementById('app-scroll');
    if (scroller && prev.app !== null) scroller.style.overflow = prev.app;
    prev = null;
  }
}

export function useLockScroll(active = true) {
  useEffect(() => {
    if (!active) return;
    lock();
    return () => unlock();
  }, [active]);
}

export default useLockScroll;
