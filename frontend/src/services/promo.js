import { api } from '../utils/api';

// Public promo list is shared across all customers, so it's safe to cache it
// in-memory: the dashboard mounts every time the customer opens Home, and
// without a cache the "Promotions & Offers" section pops in a beat late.
let _publicCache = null;
let _publicCacheAt = 0;
const PUBLIC_TTL_MS = 60_000;

// Fired on window after a claim so every voucher list (Home, wallet,
// settings) refetches instead of showing a stale "Claim" button.
export const VOUCHERS_CHANGED = 'rentech:vouchers-changed';

// Promo code API calls.
export const promoService = {
  list: () => api.get('/promo-codes'),

  get: (id) => api.get(`/promo-codes/${id}`),

  create: ({ code, discountPct, discountAmount, maxDiscount, minSpend, startsAt, maxUsesPerCustomer, firstBookingOnly, appliesToCategories, maxUses, expiresAt }) =>
    api.post('/promo-codes', {
      code, discountPct, discountAmount, maxDiscount, minSpend, startsAt,
      maxUsesPerCustomer, firstBookingOnly, appliesToCategories, maxUses, expiresAt,
    }),

  update: (id, patch) => api.put(`/promo-codes/${id}`, patch),

  remove: (id) => api.delete(`/promo-codes/${id}`),

  validate: ({ code, rentalFee, itemCategory }) =>
    api.post('/promo-codes/validate', { code, rentalFee, itemCategory }),

  // Checkout picker: every usable voucher evaluated against this booking —
  // { vouchers: [{ ...code, eligible, reason, savings, shortfall }], bestCode }.
  eligible: ({ rentalFee, itemCategory }) =>
    api.post('/promo-codes/eligible', { rentalFee, itemCategory }),

  // "My Vouchers" wallet: claimed vouchers with status active/used/expired/upcoming.
  mine: () => api.get('/promo-codes/mine'),

  // Claim a voucher into the wallet (idempotent). Drops the cached public
  // list and tells every voucher view to refetch.
  async claim(code) {
    const res = await api.post('/promo-codes/claim', { code });
    _publicCache = null;
    _publicCacheAt = 0;
    try { window.dispatchEvent(new Event(VOUCHERS_CHANGED)); } catch { /* non-browser */ }
    return res;
  },

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

  // Drop the cached public list (e.g. right after a booking consumes a code
  // so an exhausted voucher disappears instead of lingering for the TTL).
  clearPublicCache() {
    _publicCache = null;
    _publicCacheAt = 0;
  },
};
