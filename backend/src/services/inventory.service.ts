import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { ItemStatus, Prisma } from '@prisma/client';

// After an item is returned it enters a cleaning window of this many days
// before it can be rented again. Staff manually flip the item back to
// Available once cleaning is finished.
const CLEANING_DELAY_DAYS = 1;

export async function listItems(
  statusFilter?: string,
  category?: string,
  search?: string,
  opts: { rawStatus?: boolean; exclude?: string[] } = {}
) {
  const where: Prisma.InventoryItemWhereInput = {};

  if (category) {
    where.category = { equals: category, mode: 'insensitive' };
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
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
      results.push({ ...rest, effectiveStatus: displayStatus });
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

  const activeTx = item.transactions.find(tx => tx.status === 'Active' || tx.status === 'Overdue');

  let effectiveStatus: string = item.status;

  const terminal = item.status === 'Deleted' || item.status === 'OutOfService';
  if (!terminal) {
    if (activeTx) {
      effectiveStatus = activeTx.status === 'Overdue' ? 'Overdue' : 'Rented';
    } else if (item.status === 'Rented' || item.status === 'Reserved') {
      effectiveStatus = 'Available';
    } else if (item.status === 'Cleaning') {
      const recentReturn = await prisma.transaction.findFirst({
        where: { itemId: item.id, status: 'Returned', updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      });
      if (!recentReturn) effectiveStatus = 'Available';
    }
  }

  const { transactions, ...rest } = item;
  return { ...rest, effectiveStatus };
}

export async function createItem(data: {
  name: string;
  category: string;
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
  return { ...item, effectiveStatus: item.status };
}

export async function updateItem(id: number, data: {
  name?: string;
  category?: string;
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
}) {
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) {
    throw new AppError(404, 'Item not found');
  }

  // Leaving OutOfService (or any status change off it) clears the recorded
  // reason so a later re-entry starts fresh.
  const patch: Prisma.InventoryItemUpdateInput = { ...data };
  if (data.status && data.status !== ItemStatus.OutOfService && item.outOfServiceReason) {
    patch.outOfServiceReason = null;
  }

  const updated = await prisma.inventoryItem.update({ where: { id }, data: patch });
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

  await prisma.inventoryItem.delete({ where: { id } });
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
      conflictingTransactionId: overlappingTx.id,
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
    include: {
      customer: { select: { name: true } },
    },
    orderBy: { rentalDate: 'asc' },
  });

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
      customerName: tx.customer?.name || null,
    };
  });

  return { itemId, itemName: item.name, itemStatus: item.status, blockedRanges };
}
