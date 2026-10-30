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

// Shimmer sweep block — the shared skeleton primitive. Requires the global
// .rt-shimmer CSS (defined in index.css) to be present.
export const Shimmer = ({ className = '' }) => <div className={`rt-shimmer ${className}`} />;

// Featured-pieces grid placeholder (matches the landing's collection grid and
// the guest/catalog view): portrait shimmer cards in the same 4-across layout.
export function FeaturedSkeleton({ count = 4, columns = 'grid-cols-2 lg:grid-cols-4' }) {
  return (
    <div className={`grid ${columns} gap-4 md:gap-6`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl md:rounded-[28px] overflow-hidden aspect-[3/4]">
          <Shimmer className="w-full h-full" />
        </div>
      ))}
    </div>
  );
}

// Branded landing-page placeholder — the "Suspense fallback" shape. Mirrors
// the landing structure (glass nav, hero, featured pieces) so the loading
// gate feels like the page, not a bare card grid.
export function SkeletonScreen() {
  return (
    <div className="min-h-screen bg-[#FAFAFB]" aria-hidden="true">

      {/* Glass nav */}
      <div className="fixed top-0 inset-x-0 z-50 bg-[#FAFAFB]/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 md:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shimmer className="w-8 h-8 md:w-9 md:h-9 rounded-xl" />
            <Shimmer className="hidden sm:block h-4 w-28 rounded-full" />
          </div>
          <div className="flex items-center gap-3">
            <Shimmer className="hidden md:block h-4 w-16 rounded-full" />
            <Shimmer className="h-9 w-24 rounded-full" />
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 md:px-12 pt-32 md:pt-48 pb-16 md:pb-24 text-center">
        <div className="flex flex-col items-center gap-4 md:gap-5">
          <Shimmer className="h-12 md:h-16 w-4/5 max-w-xl rounded-2xl" />
          <Shimmer className="h-12 md:h-16 w-3/4 max-w-lg rounded-2xl" />
          <Shimmer className="mt-4 h-4 w-full max-w-2xl rounded-full" />
          <Shimmer className="h-4 w-2/3 max-w-md rounded-full" />
          <Shimmer className="mt-8 h-12 w-64 rounded-full" />
        </div>
      </div>

      {/* Featured pieces */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 pb-16 md:pb-24">
        <div className="text-center mb-8 md:mb-12 flex flex-col items-center gap-2.5">
          <Shimmer className="h-3 w-32 rounded-full" />
          <Shimmer className="h-8 md:h-10 w-64 md:w-80 rounded-xl" />
          <Shimmer className="h-4 w-3/4 max-w-lg rounded-full" />
        </div>
        <FeaturedSkeleton count={4} />
      </div>
    </div>
  );
}

// Page-title lines every app page opens with. Shared by the boot shell and
// the in-layout Suspense fallback so the placeholder stays put while the page
// chunk downloads, until the page's own skeleton replaces it.
export function PageTitleSkeleton() {
  return (
    <div className="space-y-2.5" aria-busy="true">
      <Shimmer className="h-7 md:h-8 w-56 md:w-72 rounded-xl" />
      <Shimmer className="h-3.5 w-40 rounded-full" />
    </div>
  );
}

// Signed-in boot placeholder (session check in flight). Mirrors AppLayout's
// geometry — sidebar, header, content column, mobile bottom nav — so when the
// real layout mounts the chrome swaps in place and the page's own skeleton
// fills the same content area. The content holds only the page-title lines
// every page starts with; page-specific shapes are left to the page itself.
export function AppShellSkeleton() {
  return (
    <div className="w-full h-screen supports-[height:100dvh]:h-[100dvh] bg-[#fcfcfd] flex flex-col md:flex-row overflow-hidden" aria-busy="true" aria-label="Loading">
      <aside className="hidden md:flex flex-col shrink-0 w-64 bg-white/80 border-r border-gray-100/50">
        <div className="p-8 border-b border-gray-100/50 flex items-center gap-3">
          <Shimmer className="w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Shimmer className="h-3.5 w-24 rounded-full" />
            <Shimmer className="h-2.5 w-12 rounded-full" />
          </div>
        </div>
        <div className="px-4 mt-4 space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3.5 px-4 py-3">
              <Shimmer className="w-[18px] h-[18px] rounded-md shrink-0" />
              <Shimmer className="h-3 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </aside>
      <main className="grow flex flex-col min-w-0">
        <header className="bg-white/70 border-b border-gray-100/50 px-5 md:px-10 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 md:invisible">
            <Shimmer className="w-8 h-8 rounded-full" />
            <Shimmer className="h-3.5 w-24 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Shimmer className="w-9 h-9 rounded-full" />
            <Shimmer className="w-9 h-9 rounded-full" />
          </div>
        </header>
        <div className="p-5 md:p-10 max-w-7xl mx-auto w-full">
          <PageTitleSkeleton />
        </div>
      </main>
      <div className="md:hidden fixed bottom-0 inset-x-0 h-20.5 bg-white/90 border-t border-gray-100/50 flex justify-around items-start pt-4 px-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Shimmer className="w-6 h-6 rounded-full" />
            <Shimmer className="h-2 w-10 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
