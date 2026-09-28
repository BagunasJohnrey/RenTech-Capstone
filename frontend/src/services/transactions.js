import { api } from '../utils/api';

// Transaction lifecycle API calls.
export const transactionsService = {
  list: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    return api.get(`/transactions${qs ? `?${qs}` : ''}`);
  },

  get: (id) => api.get(`/transactions/${id}`),

  // Staff activity timeline (who assisted / released / returned / edited).
  audits: (id) => api.get(`/transactions/${id}/audits`),

  upcoming: () => api.get('/transactions/upcoming'),

  create: (payload) => api.post('/transactions', payload),

  release: (id, patch) => api.put(`/transactions/${id}/release`, patch),

  processReturn: (id, patch) =>
    api.put(`/transactions/${id}/return`, patch),

  update: (id, patch) => api.patch(`/transactions/${id}`, patch),

  // At-pickup item swap (staff only): moves the booking onto another item.
  // Server re-derives the fee, voids the promo, and keeps the downpayment.
  swapItem: (id, payload) => api.put(`/transactions/${id}/swap-item`, payload),

  cancel: (id) => api.put(`/transactions/${id}/cancel`),

  remove: (id) => api.delete(`/transactions/${id}`),
};
