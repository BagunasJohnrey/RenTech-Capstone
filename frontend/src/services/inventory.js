import { api } from '../utils/api';

// Inventory + image storage API calls.
export const inventoryService = {
  list: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    return api.get(`/inventory${qs ? `?${qs}` : ''}`);
  },

  get: (id) => api.get(`/inventory/${id}`),

  create: (item) => api.post('/inventory', item),

  // Real hard-delete (Admin). Replaces the soft-delete-via-status workaround.
  remove: (id) => api.delete(`/inventory/${id}`),

  update: (id, patch) => api.put(`/inventory/${id}`, patch),

  quickStatus: (id, status) => api.put(`/inventory/${id}`, { status }),

  // Bulk lifecycle status change (batch "mark cleaned" / "out of service").
  bulkStatus: (ids, status, outOfServiceReason) =>
    api.patch(`/inventory/bulk-status`, { ids, status, outOfServiceReason }),

  availability: (itemId, rentalDate, dueDate) =>
    api.get(
      `/inventory/availability?itemId=${encodeURIComponent(itemId)}&rentalDate=${encodeURIComponent(rentalDate)}&dueDate=${encodeURIComponent(dueDate)}`
    ),

  blockedDates: (id) => api.get(`/inventory/blocked-dates/${id}`),

  analytics: (period) =>
    api.get(`/inventory/analytics${period ? `?period=${period}` : ''}`),
};
