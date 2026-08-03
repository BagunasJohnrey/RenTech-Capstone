import StaffTasksView from './StaffTasksView';
import CleaningQueue from '../components/CleaningQueue';

// Route-level container for the staff tasks screen.
export default function TasksPage({ inventory, onMarkClean, onBulkClean, onNavigate, ...rest }) {
  const cleaningItems = inventory.filter((i) => i.status === 'Cleaning');
  return (
    <div className="space-y-6">
      <StaffTasksView inventory={inventory} onMarkClean={onMarkClean} onNavigate={onNavigate} {...rest} />
      <CleaningQueue
        items={cleaningItems}
        onMarkClean={onMarkClean}
        onBulkClean={onBulkClean}
        onViewAll={() => onNavigate('Catalog')}
      />
    </div>
  );
}
