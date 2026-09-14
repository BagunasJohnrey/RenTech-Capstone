import { api } from '../utils/api';

// AI chatbot + report generation API calls.
export const aiService = {
  chat: ({ message, history }) =>
    api.post('/ai/chat', { message, history }),

  generateReport: (opts) => api.post('/ai/generate-report', undefined, opts),

  listReports: () => api.get('/ai/reports'),

  getReport: (id) => api.get(`/ai/reports/${id}`),

  retryReportUpload: (id) => api.post(`/ai/reports/${id}/upload`),

  deleteReport: (id) => api.delete(`/ai/reports/${id}`),
};
