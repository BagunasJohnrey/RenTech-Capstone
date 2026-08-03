import { api } from '../utils/api';

// Customer-facing catalog + bookings API calls.
export const customerService = {
  catalog: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    return api.get(`/catalog${qs ? `?${qs}` : ''}`);
  },

  catalogItem: (id) => api.get(`/catalog/${id}`),

  listBookings: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    return api.get(`/bookings${qs ? `?${qs}` : ''}`);
  },

  createBooking: (payload) => api.post('/bookings', payload),

  getBooking: (id) => api.get(`/bookings/${id}`),

  // Admin/Staff edit a customer's contact details.
  update: (id, patch) => api.put(`/customers/${id}`, patch),
};
