import { useState, useCallback } from 'react';
import { transactionsService } from '../services';

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
const FULL_TTL = 30_000;

export function invalidateTxCache(id) {
  if (id == null) fullCache.clear();
  else fullCache.delete(String(id));
}

function cachedGet(id) {
  const key = String(id);
  const hit = fullCache.get(key);
  if (hit && Date.now() - hit.at < FULL_TTL) return hit.promise;
  const job = transactionsService.get(id).then(
    (full) => full,
    (err) => { fullCache.delete(key); throw err; }
  );
  fullCache.set(key, { promise: job, at: Date.now() });
  return job;
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
  const prefetchTx = useCallback((id) => {
    if (id == null) return;
    // Warming is best-effort; swallow rejections so hover never logs noise.
    cachedGet(id).catch(() => {});
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
