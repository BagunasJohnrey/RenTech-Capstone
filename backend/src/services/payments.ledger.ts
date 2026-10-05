import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { clearDataCache } from '../utils/ttlCache.js';

export type CreditResult = {
  duplicate: boolean;
  totalPaid: number;
  balance: number;
};

// The single crediting path for every gateway. Both webhooks and the polling
// fallback call this, so idempotency, balance math, and payment classification
// are defined exactly once.
//
// `gatewayRef` is the idempotency anchor (unique in the schema): a gateway that
// retries a delivery, or a customer who retried after a QR expiry and whose
// superseded charge reports late, resolves to `duplicate: true` and credits
// nothing a second time.
//
// Everything that mutates state runs inside ONE transaction, and the balance
// update is CONDITIONAL (matching the totalPaid we read, and excluding closed
// rentals). Without that, a failure between the insert and the update left the
// money recorded but `totalPaid` unchanged — and because the retry then short-
// circuits as a duplicate, that booking could never be repaired.
export async function applyPaymentToTransaction(input: {
  transactionId: string;
  amount: number;
  gateway: 'paymongo' | 'maya';
  gatewayRef: string;
  method: 'gcash' | 'card' | 'maya';
}): Promise<CreditResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    const current = await tx.transaction.findUnique({ where: { id: input.transactionId } });
    if (!current) throw new AppError(404, 'Transaction not found');

    // A payment that lands after cancellation must not resurrect the booking.
    // Returned stays creditable: damage assessed at return leaves a balance
    // the customer may settle online afterwards.
    if (current.status === 'Cancelled') {
      throw new AppError(400, 'Transaction is already closed');
    }

    // Already applied (gateway retry, or a superseded charge reporting late).
    const existing = await tx.payment.findUnique({ where: { gatewayRef: input.gatewayRef } });
    if (existing) {
      return { duplicate: true, totalPaid: current.totalPaid, balance: current.balance };
    }

    // Never credit more than is outstanding. Maya confirms what the customer
    // actually sent, but the books can never exceed the amount owed.
    const outstanding = Math.max(
      0,
      current.rentalFee + current.latePenalty + current.damageFee - current.totalPaid,
    );
    const amount = Math.min(input.amount, outstanding);
    if (!(amount > 0)) {
      return { duplicate: true, totalPaid: current.totalPaid, balance: current.balance };
    }

    try {
      await tx.payment.create({
        data: {
          transactionId: input.transactionId,
          amount,
          method: input.method,
          type: amount >= current.rentalFee ? 'full_payment' : 'downpayment',
          gateway: input.gateway,
          gatewayRef: input.gatewayRef,
          status: 'succeeded',
        },
      });
    } catch (err: any) {
      // Concurrent deliveries both pass the findUnique above; the unique
      // gatewayRef constraint makes the loser throw P2002 — already applied.
      if (err?.code === 'P2002') {
        return { duplicate: true, totalPaid: current.totalPaid, balance: current.balance };
      }
      throw err;
    }

    const totalPaid = current.totalPaid + amount;
    const balance = Math.max(0, current.rentalFee + current.latePenalty + current.damageFee - totalPaid);

    // Conditional write: only lands if the rental wasn't cancelled AND nobody
    // else moved totalPaid since we read it. Returned is allowed (post-return
    // damage settlement). A zero count means a concurrent credit or a cancel
    // landed in between — throwing rolls the insert back for a retry.
    const updated = await tx.transaction.updateMany({
      where: {
        id: input.transactionId,
        status: { not: 'Cancelled' },
        totalPaid: current.totalPaid,
      },
      data: {
        totalPaid,
        balance,
        gateway: input.gateway,
        // Only set the ref when there isn't one, or when it IS this charge.
        // A late webhook for a superseded QR must not rewind the stored ref,
        // or the polling fallback would probe the wrong charge afterwards.
        gatewayPaymentId: current.gatewayPaymentId ?? input.gatewayRef,
      },
    });

    if (updated.count === 0) {
      throw new AppError(409, 'Transaction changed while crediting — retry');
    }

    return { duplicate: false, totalPaid, balance };
  });

  if (!outcome.duplicate) {
    await createAuditLog({
      action: 'update',
      entity: 'transaction',
      entityId: input.transactionId,
      newValue: { paymentReceived: input.amount, totalPaid: outcome.totalPaid, balance: outcome.balance },
    });
    // A succeeded payment changes revenue figures — drop the cached dashboard
    // data so the next load shows the new totals.
    clearDataCache();
  }

  return outcome;
}