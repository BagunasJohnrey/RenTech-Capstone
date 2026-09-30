// Per-page skeleton placeholders, used by the Suspense fallback so the brief
// chunk-load flash matches the real page the user is navigating to (instead of
// a generic grid). All are content-only (the real AppLayout header/sidebar are
// already rendered around them).
import { Skeleton, SkeletonGrid, SkeletonList, Shimmer, FeaturedSkeleton } from './Skeleton';

export function CatalogSkeleton() {
  return (
    <div className="space-y-6 md:space-y-8">
      {/* Page header */}
      <div className="space-y-2.5">
        <Shimmer className="h-3 w-28 rounded-full" />
        <Shimmer className="h-7 md:h-9 w-64 md:w-80 rounded-xl" />
        <Shimmer className="h-4 w-full max-w-xl rounded-full" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Shimmer className="h-10 w-full max-w-xs rounded-full" />
        <Shimmer className="h-8 w-24 rounded-full" />
        <Shimmer className="h-8 w-24 rounded-full" />
      </div>

      {/* Featured-pieces grid */}
      <FeaturedSkeleton count={8} />
    </div>
  );
}

export function HistorySkeleton() {
  return <SkeletonList count={6} />;
}

export function AIInsightsSkeleton() {
  return (
    <div className="space-y-8 max-w-lg mx-auto md:max-w-3xl lg:max-w-[1200px]">
      {/* Header + one-line controls */}
      <div className="space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-48 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm space-y-2.5">
            <Skeleton className="h-8 w-9 rounded-xl" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>

      {/* Inventory analytics card */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-56 rounded-2xl" />
      </div>

      {/* Chart + side panel rows */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-72 rounded-3xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-72 rounded-3xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-72 rounded-3xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>

      {/* Report banner + saved-reports list */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm overflow-hidden">
        <Skeleton className="h-32 rounded-none" />
        <div className="p-5 md:p-6 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-6 max-w-5xl">
      {/* Page header */}
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3 w-64 mt-1" />
      </div>

      {/* Profile card */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 flex flex-col md:flex-row items-start gap-5 md:gap-8">
        <Skeleton className="w-16 h-16 md:w-24 md:h-24 rounded-full shrink-0" />
        <div className="flex-1 w-full space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-24" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>

      {/* Paired section cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>

      {/* Wide section card */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-40 rounded-3xl" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <SkeletonGrid count={4} columns="grid-cols-2 xl:grid-cols-4" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <SkeletonList count={2} />
      </div>
    </div>
  );
}

// Selects the real skeleton for the currently active tab.
export function PageSkeleton({ tab }) {
  switch (tab) {
    case 'Catalog':
      return <CatalogSkeleton />;
    case 'History':
    case 'Tasks':
      return <HistorySkeleton />;
    case 'AI Insights':
      return <AIInsightsSkeleton />;
    case 'Profile':
    case 'Settings':
      return <ProfileSkeleton />;
    case 'Dashboard':
    case 'Home':
      return <DashboardSkeleton />;
    default:
      return <CatalogSkeleton />;
  }
}
