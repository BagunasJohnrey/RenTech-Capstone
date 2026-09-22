import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StaffTasksView from './StaffTasksView';
import CleaningQueue from '../components/CleaningQueue';
import { tabPath } from '../utils/routing';

// Route-level container for the staff tasks screen.
export default function TasksPage({ inventory, onMarkClean, onBulkClean, onNavigate, role, ...rest }) {
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

  return (
    <div className="space-y-6">
      <StaffTasksView inventory={inventory} onMarkClean={onMarkClean} onNavigate={onNavigate} role={role} {...rest} />
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
