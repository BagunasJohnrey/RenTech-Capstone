import { api } from '../utils/api';

// Business rules + SMS template settings API calls.
export const settingsService = {
  getRules: () => api.get('/settings/rules'),

  updateRules: (rules) => api.put('/settings/rules', rules),

  getSmsTemplates: () => api.get('/settings/sms-templates'),

  createSmsTemplate: ({ name, content, isDefault }) =>
    api.post('/settings/sms-templates', { name, content, isDefault }),

  updateSmsTemplate: (id, patch) =>
    api.put(`/settings/sms-templates/${id}`, patch),

  deleteSmsTemplate: (id) => api.delete(`/settings/sms-templates/${id}`),

  // Admin-only: live connectivity/health for Gemini, Semaphore, PayMongo.
  getIntegrationsStatus: () => api.get('/settings/integrations-status'),
};
