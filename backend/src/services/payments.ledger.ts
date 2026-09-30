import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { clearDataCache } from '../utils/ttlCache.js';

// The single crediting path for every gateway. Both webhooks and the polling
// fallback call this, so idempotency, balance math, and payment classification
// are defined exactly once.
//
// `gatewayRef` is the idempotency anchor (unique in the schema): a gateway that
// retries a delivery, or a customer who retried after a QR expiry and whose
// superseded charge reports late, resolves to `duplicate: true` and credits
// nothing a second time.
export async function applyPaymentToTransaction(input: {
  transactionId: string;
  amount: number;
  gateway: 'paymongo' | 'maya';
  gatewayRef: string;
  method: 'gcash' | 'card' | 'maya';
}): Promise<{ duplicate: boolean; totalPaid: number; balance: number }> {
  const tx = await prisma.transaction.findUnique({ where: { id: input.transactionId } });
  if (!tx) throw new AppError(404, 'Transaction not found');

  // A payment that lands after the rental closed must not resurrect it or add
  // to totalPaid — the balance was already settled by the return flow.
  if (tx.status === 'Returned' || tx.status === 'Cancelled') {
    throw new AppError(400, 'Transaction is already closed');
  }

  const existing = await prisma.payment.findUnique({ where: { gatewayRef: input.gatewayRef } });
  if (existing) {
    return { duplicate: true, totalPaid: tx.totalPaid, balance: tx.balance };
  }

  try {
    await prisma.payment.create({
      data: {
        transactionId: input.transactionId,
        amount: input.amount,
        method: input.method,
        type: input.amount >= tx.rentalFee ? 'full_payment' : 'downpayment',
        gateway: input.gateway,
        gatewayRef: input.gatewayRef,
        status: 'succeeded',
      },
    });
  } catch (err: any) {
    // Concurrent duplicate deliveries both pass the findUnique above; the unique
    // gatewayRef constraint makes the loser throw P2002. That is an
    // already-applied payment, not an error.
    if (err?.code === 'P2002') {
      return { duplicate: true, totalPaid: tx.totalPaid, balance: tx.balance };
    }
    throw err;
  }

  const totalPaid = tx.totalPaid + input.amount;
  const balance = Math.max(0, tx.rentalFee + tx.latePenalty + tx.damageFee - totalPaid);

  await prisma.transaction.update({
    where: { id: input.transactionId },
    data: {
      totalPaid,
      balance,
      gateway: input.gateway,
      gatewayPaymentId: input.gatewayRef,
    },
  });

  await createAuditLog({
    action: 'update',
    entity: 'transaction',
    entityId: input.transactionId,
    newValue: { paymentReceived: input.amount, totalPaid, balance },
  });

  // A succeeded payment changes revenue figures — drop the cached dashboard
  // data so the next load shows the new totals.
  clearDataCache();

  return { duplicate: false, totalPaid, balance };
}