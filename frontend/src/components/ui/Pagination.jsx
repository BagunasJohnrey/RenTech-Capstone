import { ChevronLeft, ChevronRight } from 'lucide-react';

// Prev / "Page x of y[ · summary]" / Next. Renders nothing for a single page.
// `onPageChange` receives the target page; callers clamp if they need to.
export default function Pagination({ page, totalPages, onPageChange, summary, className = '' }) {
  if (!totalPages || totalPages <= 1) return null;
  const btn =
    'inline-flex items-center justify-center gap-1 h-10 px-3 rounded-xl text-xs font-bold border border-gray-200 bg-white text-gray-700 ' +
    'hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40';
  return (
    <nav aria-label="Pagination" className={`flex items-center justify-between gap-3 ${className}`}>
      <button
        type="button"
        className={btn}
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft size={16} aria-hidden="true" /> Prev
      </button>
      <span className="text-xs font-semibold text-gray-500" aria-live="polite">
        Page {page} of {totalPages}{summary ? ` · ${summary}` : ''}
      </span>
      <button
        type="button"
        className={btn}
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        Next <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}
