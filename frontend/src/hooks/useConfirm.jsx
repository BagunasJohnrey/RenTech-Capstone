import { useState, useCallback, useRef } from 'react';
import ConfirmModal from '../components/ConfirmModal';

// Promise-based replacement for window.confirm that renders the app's
// ConfirmModal. Usage:
//   const [confirm, confirmDialog] = useConfirm();
//   if (!(await confirm({ title: 'Delete promo?', message: '…', variant: 'danger', confirmLabel: 'Delete' }))) return;
//   …and render {confirmDialog} somewhere in the component.
export function useConfirm() {
  const [opts, setOpts] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolveRef.current = resolve;
    setOpts(options || {});
  }), []);

  const settle = (value) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setOpts(null);
  };

  const dialog = opts ? (
    <ConfirmModal
      title={opts.title || 'Are you sure?'}
      message={opts.message}
      confirmLabel={opts.confirmLabel}
      cancelLabel={opts.cancelLabel}
      variant={opts.variant}
      zIndex={opts.zIndex}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return [confirm, dialog];
}
