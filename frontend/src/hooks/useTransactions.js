import { useState, useCallback } from 'react';
import { transactionsService } from '../services';

// Shared normalizer (also imported by App for optimistic updates).
export const normalizeTx = (tx) => ({
  ...tx,
  customer: tx.customer?.name ?? tx.customer ?? '',
  customerId: tx.customer?.id ?? tx.customerId ?? '',
  item: tx.item?.name ?? tx.item ?? '',
  date: tx.rentalDate ?? tx.date ?? '',
  amount: tx.rentalFee ?? tx.amount ?? 0,
});

// Merge a server `updated` transaction back into the list while preserving
// client-side display fields when the server response omits them.
const mergeUpdated = (t, updated) => ({
  ...t,
  ...updated,
  customer: updated.customer?.name ?? updated.customer ?? t.customer,
  item: updated.item?.name ?? updated.item ?? t.item,
  date: updated.rentalDate ?? updated.date ?? t.date,
  amount: updated.rentalFee ?? updated.amount ?? t.amount,
  status: updated.status ?? t.status,
});

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
    setTransactions((prev) =>
      prev.map((t) => (t.id === updated.id ? { ...t, conditionPhoto: updated.conditionPhoto } : t))
    );
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
