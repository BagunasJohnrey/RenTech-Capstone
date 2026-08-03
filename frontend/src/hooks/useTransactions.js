import { useState, useCallback } from 'react';
import { transactionsService } from '../services';

// Shared normalizer (also imported by App for optimistic updates).
// `customer` stays a display string for compatibility; `customerProfile`
// carries the full profile object (phone/address) for edit/detail views.
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
    setTransactions((prev) => [normalizeTx(created), ...prev]);
    return created;
  }, []);

  const processReturn = useCallback(async (txId, patch) => {
    const updated = await transactionsService.processReturn(txId, patch);
    setTransactions((prev) => prev.map((t) => (t.id === txId ? mergeUpdated(t, updated) : t)));
    return updated;
  }, []);

  const cancel = useCallback(async (txId) => {
    await transactionsService.cancel(txId);
    setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, status: 'Cancelled' } : t)));
  }, []);

  const remove = useCallback(async (txId) => {
    await transactionsService.remove(txId);
    setTransactions((prev) => prev.filter((t) => t.id !== txId));
  }, []);

  // Local merge only — the actual release API call lives in ReleaseItemModal.
  const release = useCallback((updated) => {
    setTransactions((prev) => prev.map((t) => (t.id === updated.id ? mergeUpdated(t, updated) : t)));
  }, []);

  // FIX G: orphaned endpoints, now available for components to consume.
  const getById = useCallback((id) => transactionsService.get(id), []);
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
    getById,
    getUpcoming,
  };
}
