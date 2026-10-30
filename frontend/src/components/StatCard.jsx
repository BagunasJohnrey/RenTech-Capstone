import { AlertTriangle, AlertCircle } from 'lucide-react';
import { Skeleton } from './Skeleton';

const VALUE_TONES = {
  alert: { text: 'text-red-500', Icon: AlertTriangle, sr: 'needs attention' },
  warning: { text: 'text-orange-500', Icon: AlertCircle, sr: 'heads up' },
};

const SUB_TONES = {
  good: 'text-emerald-600',
  bad: 'text-red-500',
  muted: 'text-gray-400',
};

// Dashboard KPI tile (staff + admin). The label always renders; only the
// number (and optional sub-line) skeleton while loading. `tone` colors the
// label + value AND adds an icon, so alert state is never color-only.
export default function StatCard({
  label,
  value,
  sub,
  subTone = 'muted',
  tone,
  loading = false,
  skeletonWidth = 'w-12',
  onClick,
}) {
  const t = tone ? VALUE_TONES[tone] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press"
    >
      <p className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider ${t ? t.text : 'text-gray-500'}`}>
        {t && <t.Icon size={12} aria-hidden="true" className="shrink-0" />}
        {label}
        {t && !loading && <span className="sr-only">({t.sr})</span>}
      </p>
      {loading ? (
        <>
          <Skeleton className={`h-8 ${skeletonWidth} mt-1 mx-auto lg:mx-0`} />
          {sub !== undefined && <Skeleton className="h-3 w-20 mt-1 mx-auto lg:mx-0" />}
        </>
      ) : (
        <>
          <p className={`text-2xl lg:text-3xl font-extrabold mt-1 ${t ? t.text : 'text-gray-900'}`}>{value}</p>
          {sub !== undefined && sub !== null && (
            <p className={`text-xs font-bold mt-0.5 ${SUB_TONES[subTone] || SUB_TONES.muted}`}>{sub}</p>
          )}
        </>
      )}
    </button>
  );
}
