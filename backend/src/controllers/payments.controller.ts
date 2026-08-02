import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as paymongoService from '../services/paymongo.service.js';
import { prisma } from '../config/database.js';
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

    const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new AppError(404, 'Transaction not found');
    if (tx.customerId !== req.user.id) throw new AppError(403, 'Not your transaction');
    if (tx.status === 'Returned' || tx.status === 'Cancelled') {
      throw new AppError(400, 'Transaction is already closed');
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
