import { useEffect } from 'react';

// Locks background scrolling while a modal is open. The app shell scrolls an
// inner div (#app-scroll — the window itself is fixed-height), so that is the
// ONLY element that gets overflow:hidden.
//
// Deliberately NOT html/body overflow:hidden: on iOS Safari that breaks
// `position: fixed` descendants (sheets render fullscreen / misplaced with a
// dead backdrop). html/body instead get overflow:clip, which prevents window
// scrolling without forming a scroll container, so fixed overlays keep working.
//
// Reference-counted so nested modals (e.g. the pay form over the detail
// sheet) can't unlock early: the background stays frozen until the last modal
// unmounts, and the backdrop remains purely a tap-to-close target.
let locks = 0;
let prev = null;

function lock() {
  if (locks === 0) {
    const scroller = document.getElementById('app-scroll');
    prev = {
      scroller,
      scrollerOverflow: scroller ? scroller.style.overflow : null,
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
    };
    if (scroller) scroller.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'clip';
    document.body.style.overflow = 'clip';
  }
  locks += 1;
}

function unlock() {
  locks = Math.max(0, locks - 1);
  if (locks === 0 && prev) {
    if (prev.scroller) prev.scroller.style.overflow = prev.scrollerOverflow;
    document.documentElement.style.overflow = prev.htmlOverflow;
    document.body.style.overflow = prev.bodyOverflow;
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
