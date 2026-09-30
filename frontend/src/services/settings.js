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
  // Pass { fresh: true } to bypass the 60s server cache (manual Refresh).
  getIntegrationsStatus: (opts) =>
    api.get(`/settings/integrations-status${opts?.fresh ? '?fresh=1' : ''}`),

  // Admin-only one-click JSON backups (Data & Backups tab).
  listBackups: () => api.get('/settings/backups'),
  createBackup: () => api.post('/settings/backups'),
  downloadBackup: (id, filename) =>
    api.download(`/settings/backups/${id}/download`, filename || `${id}.json`),
  // Restore from a previously downloaded backup file (Admin + MFA).
  // Payloads can be several MB — allow 2 minutes for the upserts.
  importBackup: (payload) =>
    api.post('/settings/backups/import', { payload }, { timeout: 120000 }),
  // Retry pushing a "server only" backup to the cloud (Admin + MFA).
  retryBackupUpload: (id) => api.post(`/settings/backups/${id}/upload`),
};
