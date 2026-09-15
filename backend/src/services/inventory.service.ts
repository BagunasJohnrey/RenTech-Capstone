import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { clearDataCache } from '../utils/ttlCache.js';
import { ItemStatus, Prisma } from '@prisma/client';

// After an item is returned it enters a cleaning window of this many days
// before it can be rented again. Staff manually flip the item back to
// Available once cleaning is finished.
const CLEANING_DELAY_DAYS = 1;

export async function listItems(
  statusFilter?: string,
  category?: string,
  search?: string,
  opts: { rawStatus?: boolean; exclude?: string[]; occasion?: string } = {}
) {
  const where: Prisma.InventoryItemWhereInput = {};

  if (category) {
    where.category = { equals: category, mode: 'insensitive' };
  }

  if (opts.occasion) {
    where.occasions = { has: opts.occasion };
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
    ];
  }

  const items = await prisma.inventoryItem.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      transactions: {
        where: { status: { in: ['Active', 'Overdue', 'Reserved'] } },
        select: { status: true, rentalDate: true, dueDate: true },
      },
      _count: {
        select: { transactions: true },
      },
    },
  });

  // Authenticated staff/admin want to see every item in its true stored status
  // (nothing collapsed/normalized away). Guests and the public catalog instead
  // get the transaction-derived "effective" status so availability reads cleanly.
  const rawStatus = opts.rawStatus === true;

  const results = [];

  for (const item of items) {
    const activeTx = item.transactions.find(tx => tx.status === 'Active' || tx.status === 'Overdue' || tx.status === 'Reserved');

    let effectiveStatus: string = item.status;

    // Terminal statuses are never overridden by rental-derived logic, so a
    // soft-deleted (or out-of-service) item always stays that way after
    // a refresh even if it still has an Active/Overdue transaction row.
    const terminal = item.status === 'Deleted' || item.status === 'OutOfService';
    if (!terminal) {
      if (activeTx) {
        effectiveStatus = activeTx.status === 'Overdue' ? 'Overdue' : activeTx.status === 'Reserved' ? 'Reserved' : 'Rented';
      } else if (item.status === 'Rented' || item.status === 'Reserved') {
        effectiveStatus = 'Available';
      }
      // 'Cleaning' is intentionally left as-is: staff manually flip the item
      // back to Available once cleaning is finished (no automatic change).
    }

    const displayStatus = rawStatus ? item.status : effectiveStatus;
    const { transactions, ...rest } = item;

    if (opts.exclude?.includes(displayStatus)) continue;

    if (!statusFilter || statusFilter === displayStatus) {
      results.push({ ...rest, effectiveStatus: displayStatus, rentalCount: item._count.transactions });
    }
  }

  return results;
}

export async function getItem(id: number) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    include: {
      transactions: {
        where: { status: { in: ['Active', 'Overdue', 'Reserved'] } },
        select: { status: true, rentalDate: true, dueDate: true },
      },
    },
  });
  if (!item) {
    throw new AppError(404, 'Item not found');
  }

  const activeTx = item.transactions.find(tx => tx.status === 'Active' || tx.status === 'Overdue' || tx.status === 'Reserved');

  let effectiveStatus: string = item.status;

  const terminal = item.status === 'Deleted' || item.status === 'OutOfService';
  if (!terminal) {
    if (activeTx) {
      effectiveStatus = activeTx.status === 'Overdue' ? 'Overdue' : activeTx.status === 'Reserved' ? 'Reserved' : 'Rented';
    } else if (item.status === 'Rented' || item.status === 'Reserved') {
      effectiveStatus = 'Available';
    }
    // 'Cleaning' is intentionally left as-is (same as listItems): staff
    // manually flip the item back to Available once cleaning is finished —
    // no automatic change, so single-item and list views always agree.
  }

  const { transactions, ...rest } = item;
  return { ...rest, effectiveStatus };
}

export async function createItem(data: {
  name: string;
  category: string;
  occasions?: string[];
  price: number;
  image?: string;
  description?: string;
  size?: string;
  status?: ItemStatus;
  outOfServiceReason?: string | null;
  onSale?: boolean;
  discountPct?: number;
  salePrice?: number;
  saleEndsAt?: string;
}) {
  const item = await prisma.inventoryItem.create({ data });
  clearDataCache();
  return { ...item, effectiveStatus: item.status };
}

export async function updateItem(id: number, data: {
  name?: string;
  category?: string;
  occasions?: string[];
  price?: number;
  status?: ItemStatus;
  outOfServiceReason?: string | null;
  image?: string;
  description?: string;
  size?: string;
  onSale?: boolean;
  discountPct?: number;
  salePrice?: number;
  saleEndsAt?: string | null;
}, performedById?: string) {
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) {
    throw new AppError(404, 'Item not found');
  }

  // Price and sale edits are revenue-relevant: audit them with old→new values
  // under their own action names so they read distinctly from status moves
  // (bulk status changes are logged separately in bulkSetStatus). Status-only
  // edits stay silent here. Non-critical: never blocks the update.
  try {
    const priceChanged = data.price !== undefined && Number(data.price) !== Number(item.price);
    if (priceChanged) {
      await createAuditLog({
        action: 'inventory.price.update', entity: 'inventory', entityId: String(id),
        performedById: performedById ?? null,
        oldValue: { price: item.price },
        newValue: { price: data.price },
      });
    }
    const saleKeys = ['onSale', 'discountPct', 'salePrice', 'saleEndsAt'] as const;
    // saleEndsAt arrives as an ISO string but reads back as a Date: normalize
    // both sides so re-sending an unchanged date doesn't log a phantom diff.
    const norm = (v: unknown) => v instanceof Date ? v.toISOString() : String(v ?? null);
    const saleChanged = saleKeys.some((k) => data[k] !== undefined && norm(data[k]) !== norm((item as Record<string, unknown>)[k]));
    if (saleChanged) {
      await createAuditLog({
        action: 'inventory.sale.update', entity: 'inventory', entityId: String(id),
        performedById: performedById ?? null,
        oldValue: {
          onSale: item.onSale, discountPct: item.discountPct,
          salePrice: item.salePrice, saleEndsAt: item.saleEndsAt,
        },
        newValue: {
          onSale: data.onSale ?? item.onSale, discountPct: data.discountPct ?? item.discountPct,
          salePrice: data.salePrice ?? item.salePrice, saleEndsAt: data.saleEndsAt ?? item.saleEndsAt,
        },
      });
    }
  } catch { /* audit is non-critical */ }

  // Leaving OutOfService (or any status change off it) clears the recorded
  // reason so a later re-entry starts fresh.
  const patch: Prisma.InventoryItemUpdateInput = { ...data };
  if (data.status && data.status !== ItemStatus.OutOfService && item.outOfServiceReason) {
    patch.outOfServiceReason = null;
  }

  // Photo replaced → delete the old stored object so the bucket doesn't
  // accumulate orphan files (skip absolute URLs, which aren't bucket objects).
  if (data.image && data.image !== item.image && item.image && !/^https?:\/\//.test(item.image)) {
    const { removeObject } = await import('./storage.service.js');
    await removeObject(item.image);
  }

  const updated = await prisma.inventoryItem.update({ where: { id }, data: patch });
  clearDataCache();
  return { ...updated, effectiveStatus: updated.status };
}

// Bulk status update for batch workflows (e.g. marking a batch of cleaned
// items Available). Only manual lifecycle states are allowed — derived states
// (Rented/Reserved/Deleted) can never be set in bulk.
const BULK_STATUSES = [ItemStatus.Available, ItemStatus.Cleaning, ItemStatus.OutOfService] as const;

export async function bulkSetStatus(
  ids: number[],
  status: 'Available' | 'Cleaning' | 'OutOfService',
  outOfServiceReason?: string | null,
  performedById?: string
) {
  if (!BULK_STATUSES.includes(status)) {
    throw new AppError(400, `Bulk status change to "${status}" is not allowed`);
  }
  if (ids.length === 0) return { updated: 0 };

  const items = await prisma.inventoryItem.findMany({ where: { id: { in: ids } } });
  if (items.length !== ids.length) {
    throw new AppError(404, 'One or more items were not found');
  }

  const result = await prisma.inventoryItem.updateMany({
    where: { id: { in: ids } },
    data: {
      status,
      outOfServiceReason: status === ItemStatus.OutOfService ? (outOfServiceReason ?? null) : null,
    },
  });

  await createAuditLog({
    action: 'update',
    entity: 'inventory',
    entityId: `bulk:${ids.join(',')}`,
    performedById,
    oldValue: { ids, statuses: items.map(i => ({ id: i.id, status: i.status })) },
    newValue: { ids, status, outOfServiceReason: status === ItemStatus.OutOfService ? (outOfServiceReason ?? null) : null },
  });

  clearDataCache();

  return { updated: result.count };
}

// Bulk sale update: set onSale/discountPct/salePrice/saleEndsAt on a batch of
// items at once. Admin-only (enforced by caller).
export async function bulkUpdateSale(
  ids: number[],
  saleData: {
    onSale: boolean;
    discountPct?: number | null;
    salePrice?: number | null;
    saleEndsAt?: string | null;
  },
  performedById?: string
) {
  if (ids.length === 0) return { updated: 0 };

  const items = await prisma.inventoryItem.findMany({ where: { id: { in: ids } } });
  if (items.length !== ids.length) {
    throw new AppError(404, 'One or more items were not found');
  }

  const result = await prisma.inventoryItem.updateMany({
    where: { id: { in: ids } },
    data: {
      onSale: saleData.onSale,
      discountPct: saleData.discountPct ?? null,
      salePrice: saleData.salePrice ?? null,
      saleEndsAt: saleData.saleEndsAt ?? null,
    },
  });

  try {
    await createAuditLog({
      action: 'update',
      entity: 'inventory',
      entityId: `bulk-sale:${ids.join(',')}`,
      performedById,
      oldValue: { ids, sale: items.map(i => ({ id: i.id, onSale: i.onSale, discountPct: i.discountPct, salePrice: i.salePrice, saleEndsAt: i.saleEndsAt })) },
      newValue: { ids, sale: saleData },
    });
  } catch { /* non-critical */ }

  clearDataCache();
  return { updated: result.count };
}

export async function deleteItem(id: number) {
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) {
    throw new AppError(404, 'Item not found');
  }

  if (item.status !== ItemStatus.Available && item.status !== ItemStatus.OutOfService) {
    throw new AppError(400, 'Only Available or Out of Service items can be deleted');
  }

  // A hard delete must not orphan history. If the item has any transaction it
  // should be archived (status=Deleted) instead of physically removed.
  const hasHistory = await prisma.transaction.findFirst({ where: { itemId: id }, select: { id: true } });
  if (hasHistory) {
    throw new AppError(400, 'Item has rental history — archive it (set status to Deleted) instead of deleting');
  }

  await prisma.inventoryItem.delete({ where: { id } });

  // Clean up the stored image so the bucket doesn't accumulate orphan files.
  if (item.image) {
    const { removeObject } = await import('./storage.service.js');
    await removeObject(item.image);
  }

  clearDataCache();
}

export async function checkAvailability(itemId: number, rentalDate: string, dueDate: string) {
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new AppError(404, 'Item not found');
  }

  if (item.status === ItemStatus.OutOfService) {
    return { available: false, reason: 'Item is currently out of service' };
  }

  // An item that is being cleaned after a return is not bookable until staff
  // manually flips it back to Available.
  if (item.status === ItemStatus.Cleaning) {
    return { available: false, reason: 'Item is currently being cleaned and cannot be booked yet' };
  }

  const start = new Date(rentalDate);
  const end = new Date(dueDate);

  // Only currently-active rentals/reservations block a new booking. Returned
  // transactions are not shown (the item is in Cleaning status instead).
  // A returned item is unavailable while being cleaned: the next pickup may
  // only start CLEANING_DELAY_DAYS after the previous due date, so shift the
  // requested start back by that delay when checking active rentals.
  const startMinusDelay = new Date(start);
  startMinusDelay.setDate(startMinusDelay.getDate() - CLEANING_DELAY_DAYS);

  const overlappingTx = await prisma.transaction.findFirst({
    where: {
      itemId,
      status: { in: ['Active', 'Overdue', 'Reserved'] },
      rentalDate: { lte: end },
      dueDate: { gte: startMinusDelay },
    },
  });

  if (overlappingTx) {
    return {
      available: false,
      reason: 'Item is already reserved or rented for the selected dates',
    };
  }

  return { available: true };
}

export async function getBlockedDates(itemId: number) {
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new AppError(404, 'Item not found');

  const transactions = await prisma.transaction.findMany({
    where: {
      itemId,
      status: { in: ['Active', 'Overdue', 'Reserved'] },
    },
    orderBy: { rentalDate: 'asc' },
  });

  // SECURITY: this endpoint is public — customer names must never be exposed
  // (previously returned `customerName`, leaking who rented an item and when).
  const blockedRanges = transactions.map(tx => {
    // Extend the blocked range by the cleaning delay so the calendar shades
    // the day the item is being cleaned as unavailable.
    const end = new Date(tx.dueDate);
    end.setDate(end.getDate() + CLEANING_DELAY_DAYS);
    return {
      transactionId: tx.id,
      start: tx.rentalDate.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      status: tx.status,
    };
  });

  return { itemId, itemName: item.name, itemStatus: item.status, blockedRanges };
}
