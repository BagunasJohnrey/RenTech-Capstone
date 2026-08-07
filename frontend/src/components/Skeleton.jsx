// Reusable skeleton loaders. Replace data-loading spinners with these so the
// UI shows a structural placeholder (shimmer) while content fetches.

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-200/80 rounded ${className}`} />;
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

// Item-card placeholder (matches ItemCard aspect + copy lines).
export function SkeletonCard({ className = '', imageRatio = 'aspect-[4/5]' }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100/80 overflow-hidden shadow-sm ${className}`}>
      <Skeleton className={`${imageRatio} w-full rounded-none`} />
      <div className="p-4 space-y-2.5">
        <Skeleton className="h-2.5 w-1/3" />
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 8, columns = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4', gap = 'gap-4', imageRatio }) {
  return (
    <div className={`grid ${gap} ${columns}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} imageRatio={imageRatio} />
      ))}
    </div>
  );
}

// Transaction / list row placeholder (matches History/Records rows).
export function SkeletonRow() {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100/80 shadow-sm flex items-center gap-3">
      <Skeleton className="w-10 h-10 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full shrink-0" />
    </div>
  );
}

export function SkeletonList({ count = 6 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

// Placeholder used for the initial app loading gate AND the Suspense fallback.
// It renders ONLY content-area skeletons (no header/sidebar) because the
// Suspense fallback is mounted inside AppLayout's content region — the real
// header/sidebar are already visible, so a full-shell skeleton would look wrong.
export function SkeletonScreen() {
  return (
    <div className="w-full h-full p-5 md:p-10 max-w-7xl mx-auto space-y-6">
      <SkeletonGrid count={8} columns="grid-cols-2 xl:grid-cols-4" />
    </div>
  );
}
