// Per-page skeleton placeholders, used by the Suspense fallback so the brief
// chunk-load flash matches the real page the user is navigating to (instead of
// a generic grid). All are content-only (the real AppLayout header/sidebar are
// already rendered around them).
import { Skeleton, SkeletonGrid, SkeletonList } from './Skeleton';

export function CatalogSkeleton() {
  return <SkeletonGrid count={8} columns="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" />;
}

export function HistorySkeleton() {
  return <SkeletonList count={6} />;
}

export function AIInsightsSkeleton() {
  return (
    <div className="space-y-4 p-1">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-40 rounded-2xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 rounded-3xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
      <Skeleton className="h-32 rounded-2xl" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-40 rounded-3xl" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <SkeletonGrid count={4} columns="grid-cols-2 md:grid-cols-4" />
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
