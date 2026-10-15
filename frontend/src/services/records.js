import { api } from '../utils/api';

// Historical record imports (paper logbooks, pre-system walk-ins).
// Analytical-only: feeds the demand forecast, never creates rentals.
export const recordsService = {
  importFile: ({ fileName, data }) => api.post('/records/import', { fileName, data }),

  list: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return api.get(`/records${qs ? `?${qs}` : ''}`);
  },

  stats: () => api.get('/records/stats'),

  remove: (id) => api.delete(`/records/${id}`),
};
