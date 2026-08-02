import { api } from '../utils/api';

// Dashboard analytics API calls.
export const dashboardService = {
  kpis: (period) =>
    api.get(`/dashboard/kpis${period ? `?period=${period}` : ''}`),

  today: () => api.get('/dashboard/today'),

  forecast: (period = 3) =>
    api.get(`/dashboard/forecast?period=${period}`),

  insights: (period) =>
    api.get(`/dashboard/insights${period ? `?period=${period}` : ''}`),
};
