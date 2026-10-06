import { useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StaffTasksView from './StaffTasksView';
import CleaningQueue from '../components/CleaningQueue';
import { HistorySkeleton } from '../components/PageSkeletons';
import { useTodayTasks } from '../hooks/useDashboard';
import { normalizeTx } from '../hooks/useTransactions';
import { tabPath } from '../utils/routing';

// Route-level container for the staff tasks screen.
export default function TasksPage({ inventory, transactions, loading, onMarkClean, onBulkClean, onNavigate, role, ...rest }) {
  const navigate = useNavigate();
  const location = useLocation();
  const cleaningRef = useRef(null);
  const cleaningItems = inventory.filter((i) => i.status === 'Cleaning');

  // Fast first paint: the tiny today-digest (~20 full rows) lands long
  // before the 500-row list. It loads here in parallel (module-cached, so
  // the DashboardView call shares it) and feeds the action queues first —
  // history/calendar sections wait for the full list (own skeletons).
  const digest = useTodayTasks(role);
  const digestLoading = !digest;
  const digestTransactions = useMemo(() => {
    if (!digest) return [];
    const rows = [
      ...(digest.overdue ?? []),
      ...(digest.dueToday ?? []),
      ...(digest.pendingPickup ?? []),
    ];
    const seen = new Set();
    return rows
      .filter((tx) => {
        if (!tx || seen.has(tx.id)) return false;
        seen.add(tx.id);
        return true;
      })
      .map(normalizeTx);
  }, [digest]);

  // The dashboard "Cleaning Queue" banner deep-links here with
  // #cleaning-queue — scroll the queue card into view on arrival.
  useEffect(() => {
    if (location.hash === '#cleaning-queue') {
      // Let the queue render first, then smooth-scroll it into view.
      const t = setTimeout(() => {
        cleaningRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [location.hash]);

  // Fast first paint: render the moment the tiny today-digest lands (~20
  // rows) instead of waiting on the 500-row list. The digest carries the
  // action queues; history/calendar sections show their own skeletons until
  // the full list arrives (see StaffTasksView).
  //
  // Gate discipline: a RESOLVED-but-empty digest is real data ("quiet day"),
  // only a PENDING fetch is "unknown". So we hold the page skeleton only
  // while both fetches are still in flight with nothing to show. Empty
  // arrays from a completed fetch render normally (possibly "All clear").
  const digestResolved = !digestLoading;
  const listHasRows = transactions && transactions.length > 0;
  const initialLoad = !digestResolved && loading && !listHasRows;

  if (initialLoad) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Staff Tasks</h2>
          <p className="text-gray-500 font-medium mt-1">Overdue reminders & upcoming schedule.</p>
        </div>
        <HistorySkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StaffTasksView inventory={inventory} transactions={transactions} digestTransactions={digestTransactions} digestLoading={digestLoading} onMarkClean={onMarkClean} onNavigate={onNavigate} role={role} {...rest} />
      <div ref={cleaningRef} id="cleaning-queue" className="scroll-mt-4">
        <CleaningQueue
          items={cleaningItems}
          onMarkClean={onMarkClean}
          onBulkClean={onBulkClean}
          // Deep-link into the catalog pre-filtered to the Cleaning status —
          // same pattern as the pickup/overdue "View All" on StaffTasksView.
          onViewAll={() => navigate(`${tabPath(role || 'Staff', 'Catalog')}?status=Cleaning`)}
        />
      </div>
    </div>
  );
}
