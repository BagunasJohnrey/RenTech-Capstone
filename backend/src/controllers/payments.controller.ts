import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as paymongoService from '../services/paymongo.service.js';
import { prisma } from '../config/database.js';
import { getBusinessRules, getPaymentGateway, parseManualQrCodes } from '../services/settings.service.js';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const createIntentSchema = z.object({
  body: z.object({
    transactionId: z.string(),
    amount: z.number().positive(),
  }),
});

export async function createPaymentIntent(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const { transactionId, amount } = req.body;

    const tx = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { payments: true },
    });
    if (!tx) throw new AppError(404, 'Transaction not found');
    // Staff/Admin may initiate a gateway charge for any booking (counter
    // checkout: customer pays on the staff device / scans the staff-shown QR).
    // Customers may only charge their own bookings.
    if (req.user.role === 'Customer' && tx.customerId !== req.user.id) throw new AppError(403, 'Not your transaction');
    // Cancelled is terminal. Returned stays chargeable so post-return damage
    // fees can still be collected online (the due<=0 check below still blocks
    // fully-settled rentals).
    if (tx.status === 'Cancelled') {
      throw new AppError(400, 'Transaction is already closed');
    }

    // SECURITY: the payment amount must be within the flat minimum payment
    // (admin business rules `min_downpayment`, default ₱200 — same floor as
    // booking-time downpayment) and the still-owed balance. Client-controlled
    // amounts outside this range are rejected — no more paying ₱1 for a ₱5,000 gown.
    const due = Math.max(0, tx.rentalFee + tx.latePenalty + tx.damageFee - tx.totalPaid);
    if (due <= 0) throw new AppError(400, 'Transaction is already fully paid');
    const rules = await getBusinessRules();
    const flatMin = parseInt(rules.min_downpayment ?? '200', 10) || 200;
    const minPayment = Math.min(flatMin, due);
    if (!Number.isFinite(amount) || amount < minPayment || amount > due) {
      throw new AppError(
        400,
        `Payment must be between ₱${minPayment.toLocaleString()} and ₱${due.toLocaleString()}`
      );
    }

    const gateway = await getPaymentGateway();

    if (gateway === 'manual') {
      const manualRules = await getBusinessRules();
      return res.json({
        gateway: 'manual',
        amount,
        qrCodes: parseManualQrCodes(manualRules.manual_qr_codes),
        simulated: false,
      });
    }

    if (gateway === 'maya') {
      const { createQrPayment } = await import('../services/maya.service.js');

      // Maya needs our return URLs so the customer has somewhere to land after
      // paying (or bailing). The transaction id rides along; the return page
      // uses it to poll for the outcome.
      const charge = await createQrPayment(
        amount,
        `Rental payment for transaction #${tx.txNumber}`,
        {
          transactionId: tx.id,
          requestReferenceNumber: String(tx.txNumber),
          redirectUrl: {
            success: `${env.FRONTEND_URL}/payment-return?tx=${tx.id}`,
            failure: `${env.FRONTEND_URL}/payment-return?tx=${tx.id}&status=failed`,
            cancel: `${env.FRONTEND_URL}/payment-return?tx=${tx.id}&status=cancelled`,
          },
        }
      );

      // Only a real charge gets a stored ref — a simulated one must not leave a
      // dangling payment id behind.
      if (!charge.simulated) {
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { gateway: 'maya', gatewayPaymentId: charge.id },
        });
      }

      res.json({
        gateway: 'maya',
        paymentId: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        status: charge.status,
        redirectUrl: charge.redirectUrl,
        qrCodeBody: charge.qrCodeBody,
        expiresAt: charge.expiresAt,
        simulated: charge.simulated ?? false,
      });
      return;
    }

    const intent = await paymongoService.createPaymentIntent(
      amount,
      `Rental payment for transaction #${tx.txNumber}`,
      { transactionId, customerId: tx.customerId }
    );

    if (!intent.simulated) {
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { gateway: 'paymongo', gatewayPaymentId: intent.id },
      });
    }

    res.json({
      gateway: 'paymongo',
      paymentIntentId: intent.id,
      clientKey: intent.clientKey,
      amount: intent.amount,
      currency: intent.currency,
      status: intent.status,
      simulated: intent.simulated ?? false,
    });
  } catch (err) {
    next(err);
  }
}

export async function getPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const paymentId = String(req.params.id);

    if (paymentId.startsWith('pi_')) {
      // Resolve local ownership before querying the gateway, so one customer
      // can't poll another customer's payment intent.
      const local = await prisma.payment.findUnique({
        where: { gatewayRef: paymentId },
        include: { transaction: { select: { customerId: true } } },
      });
      // SECURITY: resolve local ownership before querying the gateway, so one
      // customer can't read another customer's payment intent. An unknown id
      // has no owner, so it is refused too — not waved through.
      if (req.user?.role === 'Customer' && local?.transaction.customerId !== req.user.id) {
        throw new AppError(403, 'Not your payment');
      }

      const intent = await paymongoService.retrievePaymentIntent(paymentId);
      res.json(intent);
      return;
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        transaction: {
          select: { id: true, txNumber: true, customerId: true, status: true },
        },
      },
    });

    if (!payment) throw new AppError(404, 'Payment not found');

    if (req.user?.role === 'Customer' && payment.transaction.customerId !== req.user.id) {
      throw new AppError(403, 'Not your payment');
    }

    res.json(payment);
  } catch (err) {
    next(err);
  }
}

// The safety net for the unsigned Maya webhook. The webhook is the source of
// truth, but if it never arrives (blocked, lost, or rejected by a stale IP
// list) the customer polling this endpoint from their own browser repairs it:
// a Maya-confirmed payment is credited here through the same idempotent ledger
// call. Returns a coarse status only — never gateway internals.
export async function getPaymentStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const transactionId = String(req.params.transactionId);

    const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new AppError(404, 'Transaction not found');
    if (req.user.role === 'Customer' && tx.customerId !== req.user.id) {
      throw new AppError(403, 'Not your transaction');
    }

    const gateway = tx.gateway ?? 'paymongo';

    // "Succeeded" must mean the booking's required downpayment is actually
    // covered — not merely that some money arrived. Reporting success for a
    // PHP 2 partial against a PHP 5,000 rental is the bug this prevents.
    // A booking that recorded no downpayment requirement has nothing to settle
    // online, so it needs no invented minimum and no rules lookup.
    const required = tx.downpayment > 0 ? tx.downpayment : 0;
    const settled = tx.totalPaid >= required;

    const stateFor = (totalPaid: number, balance: number) => ({
      status: totalPaid >= required ? 'succeeded' : totalPaid > 0 ? 'partial' : 'pending',
      totalPaid,
      balance,
      // What a fresh charge must cover to settle the booking, so the client can
      // offer "pay again" without the customer having to visit the boutique.
      amountDue: Math.max(0, required - totalPaid),
      gateway,
    });

    // No live gateway charge to poll, or already settled by an earlier webhook.
    if (settled || gateway !== 'maya' || !tx.gatewayPaymentId) {
      return res.json(stateFor(tx.totalPaid, tx.balance));
    }

    const { retrievePayment, retrievePaymentStatus } = await import('../services/maya.service.js');
    const { applyPaymentToTransaction } = await import('../services/payments.ledger.js');

    // Prefer the authoritative retrieve (it carries the amount we must credit);
    // fall back to the cheap status-only probe if it errors.
    let status = 'PENDING';
    let amount = 0;
    let amountConfirmed = false;
    try {
      const verified = await retrievePayment(tx.gatewayPaymentId);
      status = verified.status;
      amount = verified.amount;
      amountConfirmed = true;
    } catch {
      // The secret-key call failed (bad/rotated key, transient 5xx). The
      // status-only probe uses the PUBLIC key and can still answer, but it
      // carries no amount — so we must neither credit nor claim success.
      // Without this, a wrong secret key reports EVERY payment as confirmed
      // with PHP 0 credited.
      status = (await retrievePaymentStatus(tx.gatewayPaymentId)).status;
    }

    if (!amountConfirmed) {
      return res.json(stateFor(tx.totalPaid, tx.balance));
    }

    if (status === 'SUCCESS' && amount > 0) {
      try {
        const result = await applyPaymentToTransaction({
          transactionId: tx.id,
          amount,
          gateway: 'maya',
          gatewayRef: tx.gatewayPaymentId,
          method: 'maya',
        });
        // A duplicate means THIS call did not move the money (the webhook or an
        // earlier poll already applied it, or the insert lost a race). Report
        // the state we actually know rather than claiming a success we caused.
        if (result.duplicate) {
          return res.json(stateFor(tx.totalPaid, tx.balance));
        }
        return res.json(stateFor(result.totalPaid, result.balance));
      } catch (err: any) {
        // A closed/vanished transaction can't be credited — tell the client to
        // stop polling rather than surfacing an error it can't act on.
        if (
          err?.statusCode === 400 || err?.statusCode === 404 || err?.statusCode === 409
        ) {
          return res.json({ status: 'failed', totalPaid: tx.totalPaid, balance: tx.balance, gateway });
        }
        throw err;
      }
    }

    const statusMap: Record<string, string> = {
      SUCCESS: 'succeeded',
      PAYMENT_FAILED: 'failed',
      PAYMENT_CANCELLED: 'failed',
      PAYMENT_EXPIRED: 'expired',
    };
    res.json({
      status: statusMap[status] ?? 'pending',
      totalPaid: tx.totalPaid,
      balance: tx.balance,
      gateway: 'maya',
    });
  } catch (err) {
    next(err);
  }
}
