import { api } from '../utils/api';

// AI chatbot + report generation API calls.
export const aiService = {
  chat: ({ message, history }) =>
    api.post('/ai/chat', { message, history }),

  generateReport: () => api.post('/ai/generate-report'),
};
