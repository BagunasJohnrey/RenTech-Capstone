import { useState, useCallback } from 'react';
import { inventoryService } from '../services';

// Normalize an inventory item so the UI reads a single source of truth.
// FIX C: prefer the server-computed effectiveStatus over the raw persisted status.
const normalize = (item) => ({ ...item, status: item.effectiveStatus ?? item.status });

export function useInventory() {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.list();
      setInventory((data ?? []).map(normalize));
      return data;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const addItem = useCallback(async (newItem) => {
    const payload = {
      name: newItem.name,
      category: newItem.category,
      occasions: newItem.occasions || [],
      price: newItem.price,
      status: newItem.status || 'Available',
      image: newItem.image || null,
      size: newItem.size,
      description: newItem.description,
    };
    if (newItem.onSale !== undefined) {
      payload.onSale = newItem.onSale;
      payload.discountPct = newItem.discountPct ?? null;
      payload.salePrice = newItem.salePrice ?? null;
      payload.saleEndsAt = newItem.saleEndsAt ?? null;
    }
    const created = await inventoryService.create(payload);
    setInventory((prev) => [normalize(created), ...prev]);
    return created;
  }, []);

  const updateItem = useCallback(async (updatedItem) => {
    const payload = {
      name: updatedItem.name,
      category: updatedItem.category,
      occasions: updatedItem.occasions,
      price: updatedItem.price,
      status: updatedItem.status,
      image: updatedItem.image,
      size: updatedItem.size,
      description: updatedItem.description,
    };
    if (updatedItem.onSale !== undefined) {
      payload.onSale = updatedItem.onSale;
      payload.discountPct = updatedItem.discountPct ?? null;
      payload.salePrice = updatedItem.salePrice ?? null;
      payload.saleEndsAt = updatedItem.saleEndsAt ?? null;
    }
    const result = await inventoryService.update(updatedItem.id, payload);
    setInventory((prev) => prev.map((i) => (i.id === result.id ? normalize(result) : i)));
    return result;
  }, []);

  const setStatus = useCallback(async (itemId, status, outOfServiceReason) => {
    const payload = { status };
    if (outOfServiceReason) payload.outOfServiceReason = outOfServiceReason;
    const result = await inventoryService.update(itemId, payload);
    setInventory((prev) => prev.map((i) => (i.id === result.id ? normalize(result) : i)));
    return result;
  }, []);

  // Batch status change (e.g. "mark selected items as cleaned"). Updates the
  // local list for every returned id.
  const setBulkStatus = useCallback(async (ids, status, outOfServiceReason) => {
    const result = await inventoryService.bulkStatus(ids, status, outOfServiceReason);
    const byId = new Set(ids);
    setInventory((prev) => prev.map((i) => (byId.has(i.id) ? { ...i, status, outOfServiceReason: status === 'OutOfService' ? (outOfServiceReason ?? null) : null } : i)));
    return result;
  }, []);

  // Soft-delete via status preserves the Staff role's ability to remove items.
  // The Admin-only hard DELETE remains available through inventoryService.remove.
  const deleteItem = useCallback((itemId) => setStatus(itemId, 'Deleted'), [setStatus]);

  const restoreItem = useCallback((itemId) => setStatus(itemId, 'Available'), [setStatus]);

  return {
    inventory,
    loading,
    error,
    setInventory,
    load,
    addItem,
    updateItem,
    setStatus,
    setBulkStatus,
    deleteItem,
    restoreItem,
  };
}
