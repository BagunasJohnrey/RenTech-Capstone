import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Generic confirmation dialog. Replaces the previously duplicated
// DeleteConfirmModal and LogoutModal — callers supply title/message/labels
// and a variant ('danger' for destructive red actions, 'primary' otherwise).
export default function ConfirmModal({
  title,
  subtitle,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'primary', // 'primary' | 'danger'
  icon = null,
  showClose = false,
  zIndex = 'z-[300]',
}) {
  const isDanger = variant === 'danger';
  const outerRadius = isDanger ? 'rounded-2xl' : 'rounded-3xl';
  const confirmClass = isDanger
    ? 'bg-red-500 hover:bg-red-600 rounded-xl'
    : 'bg-[#bf4a53] hover:bg-red-700 rounded-full shadow-sm shadow-red-500/20';

  // Close on Escape (works regardless of where the modal is mounted). The
  // listener is attached once via a ref so it survives parent re-renders
  // (parent callbacks get new identities every render, and tearing the
  // listener down mid-dispatch would make Escape close the parent's other
  // overlay while this modal stays open).
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') cancelRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Rendered via a portal to document.body: a `backdrop-blur` ancestor (the
  // app header) would otherwise become the containing block for the `fixed`
  // scrim, trapping it inside the header so clicks outside the dialog can't
  // dismiss it (and the modal would render mispositioned).
  return createPortal(
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm`}
      onClick={onCancel}
    >
      <div
        className={`bg-white shadow-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-200 ${outerRadius}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          {icon && (
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0 text-red-500">
              {icon}
            </div>
          )}
          <div className="flex-1">
            <h3 className="font-bold text-lg text-gray-900">{title}</h3>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          {showClose && (
            <button onClick={onCancel} className="text-gray-400 hover:bg-gray-100 rounded-full p-1">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="mb-6">
          {typeof message === 'string' ? (
            <p className="text-sm text-gray-600">{message}</p>
          ) : (
            message
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className={`flex-1 py-2.5 font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors ${isDanger ? 'rounded-xl' : 'rounded-full'}`}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 font-bold text-sm text-white transition-colors ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
