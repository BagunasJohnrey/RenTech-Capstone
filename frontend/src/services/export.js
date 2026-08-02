import { api } from '../utils/api';

// CSV export downloads (Admin/Staff).
export const exportService = {
  transactions: () => api.download('/export/transactions', 'transactions.csv'),

  revenue: () => api.download('/export/revenue', 'revenue.csv'),

  inventory: () => api.download('/export/inventory', 'inventory.csv'),
};
