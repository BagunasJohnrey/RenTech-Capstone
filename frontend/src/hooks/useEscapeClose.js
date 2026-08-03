import { useEffect } from 'react';

// Close a modal/dropdown when the user presses Escape. Attaches while
// `active` is true (default) and `onClose` is callable.
export function useEscapeClose(onClose, active = true) {
  useEffect(() => {
    if (!active || typeof onClose !== 'function') return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, active]);
}

export default useEscapeClose;
