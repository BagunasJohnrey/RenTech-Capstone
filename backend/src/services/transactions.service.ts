import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { calculateFees } from '../utils/fees.js';
import { assertItemAvailable } from '../utils/availability.js';
import { createAuditLog } from '../utils/audit.js';
import { createNotification, notifyStaffMembers } from './notifications.service.js';
import { sendSms, applyTemplate } from './semaphore.service.js';
import { ItemStatus, TransactionStatus, Prisma } from '@prisma/client';

// After an item is returned it enters a cleaning window of this many days
// before it can be rented again. Staff manually flip the item back to
// Available once cleaning is finished.
const CLEANING_DELAY_DAYS = 1;

interface CreateRentalInput {
  customerId: string;
  itemId: number;
  rentalDate: string;
  dueDate: string;
  rentalFee: number;
  downpayment?: number;
  notes?: string;
  conditionPhoto?: string;
  promoCodeId?: string;
  size?: string;
  measurements?: unknown;
}

export async function createRental(data: CreateRentalInput, processedById?: string) {
  const item = await prisma.inventoryItem.findUnique({ where: { id: data.itemId } });
  if (!item) throw new AppError(404, 'Item not found');

  // Compute effective availability
  if (item.status === ItemStatus.Damaged) {
    throw new AppError(400, 'Item is damaged and cannot be rented');
  }

  // An item being cleaned after a return, or in maintenance, cannot be booked
  // until staff manually flips its status back. This enforces the 1-day
  // cleaning window without surfacing returned rentals to customers.
  if (item.status === ItemStatus.Cleaning || item.status === ItemStatus.Maintenance) {
    throw new AppError(409, 'Item is unavailable for the selected dates (being cleaned or maintained)');
  }

  const start = new Date(data.rentalDate);
  const end = new Date(data.dueDate);

  // A booking whose rental starts in the future is an "upcoming hold": the
  // transaction is created as Reserved (and the item held as Reserved) until
  // staff release/pick it up, at which point it becomes Active/Rented.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const isFuture = start > todayStart;

  // Only currently-active rentals/reservations block a new booking. Returned
  // transactions are no longer shown — the item is in Cleaning status instead.
  // The next pickup may only start CLEANING_DELAY_DAYS after a previous due
  // date, so shift the requested start back by that delay.
  const startMinusDelay = new Date(start);
  startMinusDelay.setDate(startMinusDelay.getDate() - CLEANING_DELAY_DAYS);

  const overlapWhere: Prisma.TransactionWhereInput = {
    itemId: data.itemId,
    status: { in: ['Active', 'Overdue', 'Reserved'] as TransactionStatus[] },
    rentalDate: { lte: end },
    dueDate: { gte: startMinusDelay },
  };
  const activeWhere: Prisma.TransactionWhereInput = {
    itemId: item.id,
    status: { in: ['Active', 'Overdue', 'Reserved'] as TransactionStatus[] },
  };

  // ATOMIC: run the availability re-check + insert + status flip in ONE
  // Serializable transaction. A second concurrent booking for the same
  // item/date now either sees the first's rows (overlap -> 409) or fails with
  // a serialization/unique conflict (caught below -> 409), so two customers
  // can never both pass the check before either commits.
  let transaction;
  try {
    transaction = await prisma.$transaction(async (tx) => {
      const activeTx = await tx.transaction.findFirst({ where: activeWhere, select: { id: true } });

      // Stale Rented/Reserved without an active transaction → treat as available
      if ((item.status === ItemStatus.Rented || item.status === ItemStatus.Reserved) && !activeTx) {
        await tx.inventoryItem.update({ where: { id: item.id }, data: { status: ItemStatus.Available } });
      }

      const overlapping = await tx.transaction.findFirst({ where: overlapWhere });
      if (overlapping) {
        throw new AppError(409, 'Item is unavailable for the selected dates (rented or being cleaned)');
      }

      const balance = data.rentalFee - (data.downpayment || 0);

      const created = await tx.transaction.create({
        data: {
          customerId: data.customerId,
          processedById: processedById ?? null,
          itemId: data.itemId,
          rentalDate: start,
          dueDate: end,
          status: isFuture ? TransactionStatus.Reserved : TransactionStatus.Active,
          rentalFee: data.rentalFee,
          downpayment: data.downpayment || 0,
          balance,
          promoCodeId: data.promoCodeId ?? null,
          size: data.size ?? null,
          measurements: data.measurements as Prisma.InputJsonValue | undefined,
          notes: data.notes ?? null,
          conditionPhoto: data.conditionPhoto ?? null,
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          item: { select: { id: true, name: true, category: true } },
        },
      });

      await tx.inventoryItem.update({
        where: { id: data.itemId },
        data: { status: isFuture ? ItemStatus.Reserved : ItemStatus.Rented },
      });

      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(409, 'Item is unavailable for the selected dates');
    }
    throw err;
  }

  await createAuditLog({
    action: 'create',
    entity: 'transaction',
    entityId: transaction.id,
    performedById: processedById,
    newValue: { transactionId: transaction.id, itemId: data.itemId, customerId: data.customerId },
  });

  // Auto-confirmation notification
  try {
    await createNotification({
      profileId: data.customerId,
      transactionId: transaction.id,
      type: 'booking_confirmation',
      title: 'Booking Confirmed',
      message: `Your rental of "${transaction.item.name}" is confirmed. Due back ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`,
    });
  } catch { /* notification is non-critical */ }

  // Staff alert: a new booking was created.
  try {
    await notifyStaffMembers({
      transactionId: transaction.id,
      type: 'new_booking',
      title: 'New Booking',
      message: `${transaction.customer.name} booked "${transaction.item.name}" — due ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`,
    });
  } catch { /* notification is non-critical */ }

  // Auto-confirmation SMS
  try {
    const customerProfile = await prisma.profile.findUnique({ where: { id: data.customerId } });
    if (customerProfile?.phone) {
      const template = await prisma.smsTemplate.findFirst({ where: { name: 'booking_confirmation' } });
      const message = template?.content
        ? applyTemplate(template.content, {
            customer: customerProfile.name,
            item: transaction.item.name,
            date: end.toLocaleDateString('en-PH'),
            days: String(Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))),
          })
        : `Hi ${customerProfile.name}, your rental of "${transaction.item.name}" is confirmed. Due back ${end.toLocaleDateString('en-PH')}. Thank you!`;

      await sendSms(customerProfile.phone, message).then(() =>
        prisma.sentSms.create({
          data: {
            profileId: data.customerId,
            transactionId: transaction.id,
            message,
            status: 'sent',
          },
        })
      ).catch(() => {});
    }
  } catch { /* SMS is non-critical */ }

  return transaction;
}

export async function getTransaction(id: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, address: true } },
      processedBy: { select: { id: true, name: true } },
      item: true,
      payments: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!tx) throw new AppError(404, 'Transaction not found');
  return tx;
}

export async function listTransactions(params: {
  role: string;
  profileId: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};

  if (params.role === 'Customer') {
    where.customerId = params.profileId;
  }

  if (params.status) {
    where.status = params.status;
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true, address: true } },
          item: { select: { id: true, name: true, category: true } },
        },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 50,
      skip: params.offset || 0,
    }),
    prisma.transaction.count({ where }),
  ]);

  return { transactions, total };
}

export async function processReturn(
  transactionId: string,
  processedById: string,
  returnDate: string,
  isDamaged: boolean,
  returnPhoto?: string,
  notes?: string
) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      item: true,
      customer: { select: { id: true, name: true } },
    },
  });

  if (!tx) throw new AppError(404, 'Transaction not found');
  if (tx.status === 'Returned') throw new AppError(400, 'Transaction already returned');
  if (tx.status === 'Cancelled') throw new AppError(400, 'Transaction was cancelled');

  const retDate = new Date(returnDate);
  const fees = await calculateFees(tx.rentalDate, tx.dueDate, retDate, isDamaged);

  const additionalCharges = fees.latePenalty + fees.damageFee;
  const newBalance = tx.balance + additionalCharges;

  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      returnDate: retDate,
      status: TransactionStatus.Returned,
      latePenalty: fees.latePenalty,
      damageFee: fees.damageFee,
      balance: Math.max(0, newBalance),
      returnPhoto: returnPhoto ?? null,
      notes: notes ?? undefined,
      processedById,
    },
  });

  await prisma.inventoryItem.update({
    where: { id: tx.itemId },
    data: { status: ItemStatus.Cleaning },
  });

  await createAuditLog({
    action: 'update',
    entity: 'transaction',
    entityId: transactionId,
    performedById: processedById,
    newValue: { status: 'Returned', latePenalty: fees.latePenalty, damageFee: fees.damageFee },
    oldValue: { status: tx.status },
  });

  // Staff alert: late return (only when returned after the due date).
  if (retDate.getTime() > tx.dueDate.getTime()) {
    try {
      await notifyStaffMembers({
        transactionId,
        type: 'late_return',
        title: 'Late Return',
        message: `${tx.customer.name} returned "${tx.item.name}" late — penalty ₱${fees.latePenalty.toLocaleString()}.`,
      });
    } catch { /* notification is non-critical */ }
  }

  return { ...updated, fees };
}

// EDIT booking details (dates + notes only) without cancel+re-book. Reuses the
// same overlap check as createRental so an edit can't collide with another
// booking, and runs read+check+update in one Serializable transaction.
export async function updateTransaction(
  transactionId: string,
  performedById: string,
  patch: { rentalDate?: string; dueDate?: string; notes?: string }
) {
  const existing = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true, itemId: true, status: true, rentalDate: true, dueDate: true, notes: true,
      customerId: true, item: { select: { id: true, name: true } },
    },
  });
  if (!existing) throw new AppError(404, 'Transaction not found');
  if (existing.status === 'Returned') throw new AppError(400, 'Cannot edit a returned transaction');
  if (existing.status === 'Cancelled') throw new AppError(400, 'Cannot edit a cancelled transaction');

  const nextRental = patch.rentalDate ? new Date(patch.rentalDate) : existing.rentalDate;
  const nextDue = patch.dueDate ? new Date(patch.dueDate) : existing.dueDate;
  if (isNaN(nextRental.getTime()) || isNaN(nextDue.getTime())) {
    throw new AppError(400, 'Invalid rentalDate/dueDate');
  }
  if (nextRental.getTime() > nextDue.getTime()) {
    throw new AppError(400, 'Pickup date must be on or before the due date');
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      await assertItemAvailable(
        {
          itemId: existing.itemId,
          rentalDate: nextRental,
          dueDate: nextDue,
          excludeTxId: transactionId,
          cleaningDelayDays: CLEANING_DELAY_DAYS,
        },
        tx
      );

      return tx.transaction.update({
        where: { id: transactionId },
        data: {
          rentalDate: nextRental,
          dueDate: nextDue,
          notes: patch.notes !== undefined ? patch.notes : existing.notes,
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          item: { select: { id: true, name: true, category: true } },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(409, 'Item is unavailable for the selected dates');
    }
    throw err;
  }

  await createAuditLog({
    action: 'update',
    entity: 'transaction',
    entityId: transactionId,
    performedById,
    oldValue: { rentalDate: existing.rentalDate, dueDate: existing.dueDate, notes: existing.notes },
    newValue: { rentalDate: nextRental, dueDate: nextDue, notes: updated.notes },
  });

  return updated;
}

export async function cancelTransaction(transactionId: string, performedById: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { item: true },
  });

  if (!tx) throw new AppError(404, 'Transaction not found');
  if (tx.status === 'Returned') throw new AppError(400, 'Cannot cancel a returned transaction');
  if (tx.status === 'Cancelled') throw new AppError(400, 'Transaction already cancelled');

  await prisma.transaction.update({
    where: { id: transactionId },
    data: { status: TransactionStatus.Cancelled },
  });

  await prisma.inventoryItem.update({
    where: { id: tx.itemId },
    data: { status: ItemStatus.Available },
  });

  await createAuditLog({
    action: 'update',
    entity: 'transaction',
    entityId: transactionId,
    performedById,
    newValue: { status: 'Cancelled' },
    oldValue: { status: tx.status },
  });

  return { message: 'Transaction cancelled' };
}

export async function deleteTransaction(transactionId: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { item: true },
  });

  if (!tx) throw new AppError(404, 'Transaction not found');

  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { transactionId } }),
    prisma.notification.deleteMany({ where: { transactionId } }),
    prisma.sentSms.deleteMany({ where: { transactionId } }),
    prisma.transaction.delete({ where: { id: transactionId } }),
  ]);

  const nonReturnedStatuses = ['Active', 'Overdue'];
  if (nonReturnedStatuses.includes(tx.status) && tx.item.status !== 'Damaged') {
    await prisma.inventoryItem.update({
      where: { id: tx.itemId },
      data: { status: ItemStatus.Available },
    });
  }

  return { message: 'Transaction deleted' };
}

export async function releaseRental(
  transactionId: string,
  processedById: string,
  releasePhoto?: string,
  notes?: string
) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { item: true },
  });

  if (!tx) throw new AppError(404, 'Transaction not found');
  if (tx.status === TransactionStatus.Returned) throw new AppError(400, 'Transaction already returned');
  if (tx.status === TransactionStatus.Cancelled) throw new AppError(400, 'Transaction was cancelled');

  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      // Releasing/picking up an item moves an upcoming hold (Reserved) into an
      // active rental (Active) and marks the item as Rented.
      status: TransactionStatus.Active,
      releasePhoto: releasePhoto ?? null,
      notes: notes ?? undefined,
      processedById,
    },
  });

  await prisma.inventoryItem.update({
    where: { id: tx.itemId },
    data: { status: ItemStatus.Rented },
  });

  await createAuditLog({
    action: 'update',
    entity: 'transaction',
    entityId: transactionId,
    performedById: processedById,
    newValue: { status: 'Active', released: true },
    oldValue: { status: tx.status },
  });

  return updated;
}

export async function getUpcomingReturns() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const threeDaysFromNow = new Date(today);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  const transactions = await prisma.transaction.findMany({
    where: {
      status: { in: ['Active', 'Overdue'] },
      dueDate: { lte: threeDaysFromNow },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      item: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  return transactions;
}
