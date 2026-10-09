import { api } from '../utils/api';

// Public promo list is shared across all customers, so it's safe to cache it
// in-memory: the dashboard mounts every time the customer opens Home, and
// without a cache the "Promotions & Offers" section pops in a beat late.
let _publicCache = null;
let _publicCacheAt = 0;
const PUBLIC_TTL_MS = 60_000;

// Promo code API calls.
export const promoService = {
  list: () => api.get('/promo-codes'),

  get: (id) => api.get(`/promo-codes/${id}`),

  create: ({ code, discountPct, discountAmount, minSpend, startsAt, maxUsesPerCustomer, firstBookingOnly, appliesToCategories, maxUses, expiresAt }) =>
    api.post('/promo-codes', {
      code, discountPct, discountAmount, minSpend, startsAt,
      maxUsesPerCustomer, firstBookingOnly, appliesToCategories, maxUses, expiresAt,
    }),

  update: (id, patch) => api.put(`/promo-codes/${id}`, patch),

  remove: (id) => api.delete(`/promo-codes/${id}`),

  validate: ({ code, rentalFee, itemCategory }) =>
    api.post('/promo-codes/validate', { code, rentalFee, itemCategory }),

  // Customer-facing: currently-usable codes (active, unexpired, has uses left).
  // Cached 60s so the dashboard doesn't refetch on every Home mount.
  async listPublic() {
    const now = Date.now();
    if (_publicCache && now - _publicCacheAt < PUBLIC_TTL_MS) return _publicCache;
    const d = await api.get('/promo-codes/public');
    _publicCache = d;
    _publicCacheAt = now;
    return d;
  },
};
