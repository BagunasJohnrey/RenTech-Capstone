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

  upcoming: () => api.get('/transactions/upcoming'),

  create: (payload) => api.post('/transactions', payload),

  release: (id, patch) => api.put(`/transactions/${id}/release`, patch),

  processReturn: (id, patch) =>
    api.put(`/transactions/${id}/return`, patch),

  update: (id, patch) => api.patch(`/transactions/${id}`, patch),

  cancel: (id) => api.put(`/transactions/${id}/cancel`),

  remove: (id) => api.delete(`/transactions/${id}`),
};
