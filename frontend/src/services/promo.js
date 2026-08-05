import { api } from '../utils/api';

// Promo code API calls.
export const promoService = {
  list: () => api.get('/promo-codes'),

  get: (id) => api.get(`/promo-codes/${id}`),

  create: ({ code, discountPct, maxUses, expiresAt }) =>
    api.post('/promo-codes', { code, discountPct, maxUses, expiresAt }),

  update: (id, patch) => api.put(`/promo-codes/${id}`, patch),

  remove: (id) => api.delete(`/promo-codes/${id}`),

  validate: ({ code, rentalFee }) =>
    api.post('/promo-codes/validate', { code, rentalFee }),

  // Customer-facing: currently-usable codes (active, unexpired, has uses left).
  listPublic: () => api.get('/promo-codes/public'),
};
