import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StaffTasksView from './StaffTasksView';
import CleaningQueue from '../components/CleaningQueue';
import { HistorySkeleton } from '../components/PageSkeletons';
import { tabPath } from '../utils/routing';

// Route-level container for the staff tasks screen.
export default function TasksPage({ inventory, transactions, loading, onMarkClean, onBulkClean, onNavigate, role, ...rest }) {
  const navigate = useNavigate();
  const location = useLocation();
  const cleaningRef = useRef(null);
  const cleaningItems = inventory.filter((i) => i.status === 'Cleaning');

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

  // First load: hold a skeleton until the transaction list arrives. The
  // empty array is the hook's initial state, not real data — rendering the
  // view with it flashes "All clear / No recent activity" before the fetch
  // resolves (false-empty bug). Once the list has arrived at least once,
  // later refetches keep showing data (a refetch error leaves the old rows
  // in place — `load` only replaces on success).
  const initialLoad = loading && (!transactions || transactions.length === 0);

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
      <StaffTasksView inventory={inventory} transactions={transactions} onMarkClean={onMarkClean} onNavigate={onNavigate} role={role} {...rest} />
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
