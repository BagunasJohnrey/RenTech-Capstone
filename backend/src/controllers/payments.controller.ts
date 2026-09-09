import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as paymongoService from '../services/paymongo.service.js';
import { prisma } from '../config/database.js';
import { getBusinessRules } from '../services/settings.service.js';
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
    if (tx.customerId !== req.user.id) throw new AppError(403, 'Not your transaction');
    if (tx.status === 'Returned' || tx.status === 'Cancelled') {
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

    const intent = await paymongoService.createPaymentIntent(
      amount,
      `Rental payment for transaction #${tx.txNumber}`,
      { transactionId, customerId: req.user.id }
    );

    await prisma.transaction.update({
      where: { id: transactionId },
      data: { paymentIntentId: intent.id },
    });

    res.json({
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
        where: { paymongoPiId: paymentId },
        include: { transaction: { select: { customerId: true } } },
      });
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
