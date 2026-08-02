import { api } from '../utils/api';

// Notification API calls.
export const notificationsService = {
  list: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    return api.get(`/notifications${qs ? `?${qs}` : ''}`);
  },

  readAll: () => api.put('/notifications/read-all'),

  unreadCount: () => api.get('/notifications/unread-count'),

  markRead: (id) => api.put(`/notifications/${id}/read`),
};
