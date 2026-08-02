import { api } from '../utils/api';

// All auth-related API calls. Wraps /api/auth endpoints.
export const authService = {
  login: (email, password) =>
    api.post('/auth/login', { email, password }),

  signup: ({ email, password, name, phone, address, preferences }) =>
    api.post('/auth/signup', { email, password, name, phone, address, preferences }),

  logout: () => api.post('/auth/logout'),

  getMe: () => api.get('/auth/me'),

  updateMe: (data) => api.put('/auth/me', data),

  verifyAdmin: (email, password) =>
    api.post('/auth/verify-admin', { email, password }),

  listStaff: () => api.get('/auth/staff'),

  createStaff: ({ email, password, name, phone }) =>
    api.post('/auth/staff', { email, password, name, phone }),

  deleteStaff: (id) => api.delete(`/auth/staff/${id}`),
};
