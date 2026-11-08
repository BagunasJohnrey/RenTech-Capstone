import { useState, useCallback } from 'react';
import { transactionsService } from '../services';
import { preloadDisplayImage, thumbKeyFor } from '../utils/images';

// Shared normalizer (also imported by App for optimistic updates).
// `customer` stays a display string for compatibility; `customerProfile`
// carries the full profile object (phone/address) for edit/detail views.
// Digest rows (/dashboard/today) are FULL records, so they normalize
// identically to list rows — Tasks paints from the digest first.
export const normalizeTx = (tx) => ({
  ...tx,
  customer: tx.customer?.name ?? tx.customer ?? '',
  customerProfile: tx.customer ?? null,
  customerId: tx.customer?.id ?? tx.customerId ?? '',
  item: tx.item?.name ?? tx.item ?? '',
  // `item` is flattened to its name above; keep the photo path for views
  // that show it (e.g. the Edit Rental desktop panel).
  itemImage: tx.item?.image ?? tx.itemImage ?? null,
  date: tx.rentalDate ?? tx.date ?? '',
  amount: tx.rentalFee ?? tx.amount ?? 0,
});

// An item is physically "with the customer" (picked up) once a release/condition
// photo exists. Until then it is still pending release (on hold / reserved).
export const isReleased = (tx) => !!(tx.releasePhoto || tx.conditionPhoto);
export const getReleasePhoto = (tx) => tx.releasePhoto || tx.conditionPhoto || null;

// A transaction can be returned once the item is out the door: either it was
// released (photo proof) or inventory still shows the item as Rented. This keeps
// the Return action available for legacy rentals created before the release flow.
export const canReturn = (tx, inventory = []) =>
  isReleased(tx) || inventory.some((i) => i.id === tx.itemId && i.status === 'Rented');

// Merge a server `updated` transaction back into the list while preserving
// client-side display fields when the server response omits them.
const mergeUpdated = (t, updated) => normalizeTx({ ...t, ...updated });

// Short-lived full-record cache (module-level = shared across hook users).
// The detail modal enriches via getById on every open (~500ms round-trip on
// a slow connection — the visible "settle" after opening). Warming this on
// row hover/tap means the enrichment usually resolves synchronously.
// TTL is deliberately tiny (30s) and every mutation below invalidates, so
// no screen can serve materially stale data.
const fullCache = new Map(); // id -> { promise, at }
// Staff Activity timeline, cached + warmed the same way so the detail sheet
// doesn't hold its skeleton for a second, uncached round trip.
const auditCache = new Map(); // id -> { promise, at }
const FULL_TTL = 30_000;

// Last RESOLVED value per id, kept longer than the request cache so a
// re-opened sheet paints instantly from memory (stale-while-revalidate: the
// modal still refetches in the background and swaps in fresh data).
const fullValues = new Map(); // id -> { value, at }
const auditValues = new Map(); // id -> { value, at }
const PEEK_TTL = 5 * 60_000;

export function invalidateTxCache(id) {
  if (id == null) { fullCache.clear(); auditCache.clear(); fullValues.clear(); auditValues.clear(); }
  else {
    const k = String(id);
    fullCache.delete(k); auditCache.delete(k); fullValues.delete(k); auditValues.delete(k);
  }
}

function cachedFetch(cache, id, fetcher, values) {
  const key = String(id);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FULL_TTL) return hit.promise;
  const job = fetcher(id).then(
    (v) => { if (values) values.set(key, { value: v, at: Date.now() }); return v; },
    (err) => { cache.delete(key); throw err; }
  );
  cache.set(key, { promise: job, at: Date.now() });
  return job;
}

function peek(values, id) {
  if (id == null) return null;
  const hit = values.get(String(id));
  return hit && Date.now() - hit.at < PEEK_TTL ? hit.value : null;
}
// Synchronous reads of an already-fetched record / timeline (or null).
export const peekFullTx = (id) => peek(fullValues, id);
export const peekTxAudits = (id) => peek(auditValues, id);

// Staff/Admin only (the endpoint 403s customers).
// The detail sheet shows the small previews (`thumbs/…`), so warm those.
export function preloadTxPhotos(tx) {
  if (!tx) return;
  const warm = (p) => { if (typeof p === 'string' && p.startsWith('rental/')) preloadDisplayImage(thumbKeyFor(p)); };
  warm(tx.releasePhoto || tx.conditionPhoto);
  warm(tx.returnPhoto);
}

export function getTxAudits(id) {
  return cachedFetch(auditCache, id, transactionsService.audits, auditValues);
}

function cachedGet(id) {
  return cachedFetch(fullCache, id, transactionsService.get, fullValues);
}

export function useTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await transactionsService.list();
      const raw = data?.transactions ?? data ?? [];
      setTransactions(raw.map(normalizeTx));
      return raw;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(async (payload) => {
    const created = await transactionsService.create(payload);
    invalidateTxCache();
    setTransactions((prev) => [normalizeTx(created), ...prev]);
    return created;
  }, []);

  const processReturn = useCallback(async (txId, patch) => {
    const updated = await transactionsService.processReturn(txId, patch);
    invalidateTxCache(txId);
    setTransactions((prev) => prev.map((t) => (t.id === txId ? mergeUpdated(t, updated) : t)));
    return updated;
  }, []);

  const cancel = useCallback(async (txId) => {
    const result = await transactionsService.cancel(txId);
    invalidateTxCache(txId);
    setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, status: 'Cancelled' } : t)));
    return result ?? null;
  }, []);

  const remove = useCallback(async (txId) => {
    await transactionsService.remove(txId);
    invalidateTxCache(txId);
    setTransactions((prev) => prev.filter((t) => t.id !== txId));
  }, []);

  // Local merge only — the actual release API call lives in ReleaseItemModal.
  const release = useCallback((updated) => {
    invalidateTxCache(updated?.id);
    setTransactions((prev) => prev.map((t) => (t.id === updated.id ? mergeUpdated(t, updated) : t)));
  }, []);

  // Local merge for EditRentalModal saves — the API calls live in the modal,
  // which reports back { type, updated }. Booking saves carry the updated
  // transaction (merged by id, like release); customer saves carry the updated
  // profile (applied to every row of that customer so the list shows the new
  // name/phone/address without a refresh).
  const applyEdit = useCallback((saved) => {
    if (!saved) return;
    if (saved.type === 'customer' && saved.updated) {
      const u = saved.updated;
      invalidateTxCache();
      setTransactions((prev) => prev.map((t) => {
        const sameCustomer = String(t.customerId ?? '') === String(u.id ?? '')
          || t.customerProfile?.id === u.id;
        if (!sameCustomer) return t;
        const profile = { ...(t.customerProfile || {}), ...u };
        return normalizeTx({
          ...t,
          customer: profile,
          customerProfile: profile,
          contact: u.phone ?? t.contact,
          address: u.address ?? t.address,
        });
      }));
      return;
    }
    const updated = saved.updated ?? saved;
    if (!updated?.id) return;
    invalidateTxCache(updated.id);
    setTransactions((prev) => prev.map((t) => (t.id === updated.id ? mergeUpdated(t, updated) : t)));
  }, []);

  // Full-record fetch through the short-lived cache (see above). Components
  // warming a record they are about to open should use prefetchTx instead.
  const getById = useCallback((id) => cachedGet(id), []);
  const prefetchTx = useCallback((id, { withAudits = false } = {}) => {
    if (id == null) return;
    // Warming is best-effort; swallow rejections so hover never logs noise.
    // Condition photos are warmed too: their signing + download is the
    // slowest part of the detail sheet.
    cachedGet(id).then(preloadTxPhotos).catch(() => {});
    if (withAudits) getTxAudits(id).catch(() => {});
  }, []);
  const getUpcoming = useCallback(() => transactionsService.upcoming(), []);

  return {
    transactions,
    loading,
    error,
    setTransactions,
    load,
    create,
    processReturn,
    cancel,
    remove,
    release,
    applyEdit,
    getById,
    prefetchTx,
    getUpcoming,
  };
}
