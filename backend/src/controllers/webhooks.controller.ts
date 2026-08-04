import { Request, Response, NextFunction } from 'express';
import * as paymongoService from '../services/paymongo.service.js';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';

export async function handlePayMongoWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const signature = req.headers['paymongo-signature'] as string;
    const rawBody = (req as unknown as { rawBody: string }).rawBody;

    if (!rawBody || !signature) {
      throw new AppError(400, 'Missing webhook signature or body');
    }

    const isValid = paymongoService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      throw new AppError(401, 'Invalid webhook signature');
    }

    const event = req.body as {
      data?: {
        attributes?: {
          type?: string;
          data?: {
            id?: string;
            attributes?: {
              status?: string;
              amount?: number;
              metadata?: Record<string, string>;
              payments?: { id: string; attributes: { amount: number; status: string; source: string } }[];
            };
          };
        };
      };
    };

    const eventType = event?.data?.attributes?.type;
    const paymentIntent = event?.data?.attributes?.data;

    if (!eventType || !paymentIntent) {
      throw new AppError(400, 'Invalid webhook payload');
    }

    if (eventType === 'payment_intent.payment_succeeded') {
      const piId = paymentIntent.id;
      const meta = paymentIntent.attributes?.metadata || {};
      const transactionId = meta.transactionId;
      const amount = (paymentIntent.attributes?.amount || 0) / 100;
      const paymentData = paymentIntent.attributes?.payments?.[0];
      const method = paymentData?.attributes?.source === 'gcash' ? 'gcash' : 'card';

      if (!transactionId) {
        throw new AppError(400, 'Missing transactionId in payment metadata');
      }

      const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
      if (!tx) throw new AppError(404, 'Transaction not found');

      // Idempotency: PayMongo retries webhooks on transient failures. If this
      // payment intent was already applied, acknowledge silently instead of
      // double-recording the payment and corrupting the balance.
      const existing = await prisma.payment.findUnique({ where: { paymongoPiId: piId } });
      if (existing) {
        return res.json({ received: true, duplicate: true });
      }

      await prisma.payment.create({
        data: {
          transactionId,
          amount,
          method,
          type: amount >= tx.rentalFee ? 'full_payment' : 'downpayment',
          paymongoPiId: piId,
          status: 'succeeded',
        },
      });

      const newTotalPaid = tx.totalPaid + amount;
      const newBalance = Math.max(0, tx.rentalFee + tx.latePenalty + tx.damageFee - newTotalPaid);

      await prisma.transaction.update({
        where: { id: transactionId },
        data: {
          totalPaid: newTotalPaid,
          balance: newBalance,
          paymentIntentId: piId,
        },
      });

      await createAuditLog({
        action: 'update',
        entity: 'transaction',
        entityId: transactionId,
        newValue: { paymentReceived: amount, totalPaid: newTotalPaid, balance: newBalance },
      });
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}
