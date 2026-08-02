import { api } from '../utils/api';

// SMS sending + history API calls.
export const smsService = {
  send: ({ profileId, message, templateId, transactionId }) =>
    api.post('/sms/send', { profileId, message, templateId, transactionId }),

  history: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return api.get(`/sms/history${qs ? `?${qs}` : ''}`);
  },
};
