import { api } from '../utils/api';

// All auth-related API calls. Wraps /api/auth endpoints.
// Phase 1: auth state is cookie-backed; these calls no longer return or
// store tokens on the client. The `refresh` helper triggers a silent cookie
// rotation via the backend /auth/refresh endpoint.
export const authService = {
  login: (email, password) =>
    api.post('/auth/login', { email, password }),

  signup: ({ email, password, name, phone, address, preferences }) =>
    api.post('/auth/signup', { email, password, name, phone, address, preferences }),

  logout: () => api.post('/auth/logout'),

  refresh: () => api.post('/auth/refresh', {}, { timeout: 10000 }),

  getMe: () => api.get('/auth/me'),

  updateMe: (data) => api.put('/auth/me', data),

  verifyAdmin: (email, password) =>
    api.post('/auth/verify-admin', { email, password }),

  forgotPassword: (email) =>
    api.post('/auth/forgot-password', { email }),

  resetPassword: (credential, password) =>
    api.post('/auth/reset-password', { ...credential, password }),

  listStaff: () => api.get('/auth/staff'),

  createStaff: ({ email, name, phone }) =>
    api.post('/auth/staff', { email, name, phone }),

  deleteStaff: (id) => api.delete(`/auth/staff/${id}`),
};
