import { useNavigate } from 'react-router-dom';
import StaffTasksView from './StaffTasksView';
import CleaningQueue from '../components/CleaningQueue';
import { tabPath } from '../utils/routing';

// Route-level container for the staff tasks screen.
export default function TasksPage({ inventory, onMarkClean, onBulkClean, onNavigate, role, ...rest }) {
  const navigate = useNavigate();
  const cleaningItems = inventory.filter((i) => i.status === 'Cleaning');
  return (
    <div className="space-y-6">
      <StaffTasksView inventory={inventory} onMarkClean={onMarkClean} onNavigate={onNavigate} role={role} {...rest} />
      <CleaningQueue
        items={cleaningItems}
        onMarkClean={onMarkClean}
        onBulkClean={onBulkClean}
        // Deep-link into the catalog pre-filtered to the Cleaning status —
        // same pattern as the pickup/overdue "View All" on StaffTasksView.
        onViewAll={() => navigate(`${tabPath(role || 'Staff', 'Catalog')}?status=Cleaning`)}
      />
    </div>
  );
}
