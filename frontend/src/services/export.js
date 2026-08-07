import { api } from '../utils/api';

// Excel (.xlsx) export downloads (Admin/Staff). Backend serves professionally
// styled workbooks — branded header, status-colored cells, totals, frozen
// header + autofilter.
export const exportService = {
  transactions: () => api.download('/export/transactions', 'transactions.xlsx'),

  revenue: () => api.download('/export/revenue', 'revenue.xlsx'),

  inventory: () => api.download('/export/inventory', 'inventory.xlsx'),
};
