import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { Prisma, TransactionStatus } from '@prisma/client';

const ACTIVE_BLOCKING: TransactionStatus[] = ['Active', 'Overdue', 'Reserved'];

// Shared overlap check for (re)booking an item between two dates. Kept in one
// place so createRental() and the booking-edit endpoint enforce the exact same
// availability rules and a date edit can't accidentally overlap another booking.
//
// `excludeTxId` lets an edit ignore the transaction being moved (so editing a
// booking to slightly different dates isn't considered "overlapping itself").
// `cleaningDelayDays` mirrors the buffer createRental applies to a return.
export async function assertItemAvailable(
  args: {
    itemId: number;
    rentalDate: Date;
    dueDate: Date;
    excludeTxId?: string;
    cleaningDelayDays?: number;
  },
  tx?: Prisma.TransactionClient
) {
  const db = tx ?? prisma;
  const { itemId, rentalDate, dueDate, excludeTxId, cleaningDelayDays = 0 } = args;

  const startMinusDelay = new Date(rentalDate);
  startMinusDelay.setDate(startMinusDelay.getDate() - cleaningDelayDays);

  const where: Prisma.TransactionWhereInput = {
    itemId,
    status: { in: ACTIVE_BLOCKING },
    rentalDate: { lte: dueDate },
    dueDate: { gte: startMinusDelay },
    ...(excludeTxId ? { id: { not: excludeTxId } } : {}),
  };

  const overlapping = await db.transaction.findFirst({ where });
  if (overlapping) {
    throw new AppError(409, 'Item is unavailable for the selected dates');
  }
}
