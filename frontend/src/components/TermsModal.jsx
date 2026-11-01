import { useEffect, useRef, useState } from 'react';
import { X, ScrollText, ShieldCheck, ChevronsDown } from 'lucide-react';
import TermsContent from './TermsContent';
import { useEscapeClose } from '../hooks/useEscapeClose';

// Terms and Conditions / Privacy Policy sheet shared by email + Google
// sign-up. "I Agree" stays disabled until the reader scrolls to the end;
// reaching the end is reported back (onRead) so the sign-up checkbox can
// unlock even if they close without tapping "I Agree".
export default function TermsModal({ alreadyRead = false, onRead, onAgree, onClose }) {
  const scrollRef = useRef(null);
  const [readToEnd, setReadToEnd] = useState(alreadyRead);
  useEscapeClose(onClose);

  const checkEnd = () => {
    const el = scrollRef.current;
    if (!el || readToEnd) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
      setReadToEnd(true);
      onRead?.();
    }
  };
  // Content shorter than the viewport is "read" as soon as it shows.
  useEffect(checkEnd); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title-terms"
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start sm:items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[#bf4a53]/10 border border-[#bf4a53]/20 flex items-center justify-center text-[#bf4a53] shrink-0">
              <ScrollText size={18} />
            </span>
            <div className="min-w-0">
              <h3 id="dialog-title-terms" className="font-bold text-gray-900 text-sm sm:text-base">Terms and Conditions</h3>
              <p className="text-[11px] sm:text-xs text-gray-500">Effective date: August 2026</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0" aria-label="Close terms">
            <X size={18} />
          </button>
        </div>
        <div ref={scrollRef} onScroll={checkEnd} className="px-4 sm:px-6 py-5 overflow-y-auto">
          <TermsContent />
        </div>
        <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 bg-gray-50/60">
          {readToEnd ? (
            <p className="text-[11px] sm:text-xs text-gray-500 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
              We collect your data securely and never sell it.
            </p>
          ) : (
            <p className="text-[11px] sm:text-xs font-semibold text-amber-700 flex items-center gap-1.5" aria-live="polite">
              <ChevronsDown size={14} className="shrink-0" />
              Scroll to the end to enable "I Agree".
            </p>
          )}
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 text-sm font-bold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100">
              Close
            </button>
            <button
              onClick={onAgree}
              disabled={!readToEnd}
              className="flex-1 sm:flex-none px-4 py-2.5 text-sm font-bold text-white bg-[#bf4a53] rounded-xl hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#bf4a53]"
            >
              I Agree
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
