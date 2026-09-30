import { Request, Response, NextFunction } from 'express';
import * as paymongoService from '../services/paymongo.service.js';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { applyPaymentToTransaction } from '../services/payments.ledger.js';

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
      // The gatewayRef is the idempotency anchor, so an event without one can't
      // be recorded safely — rejecting is the only way to avoid a double credit.
      if (!piId) {
        throw new AppError(400, 'Missing payment id in webhook payload');
      }
      if (!(amount > 0)) {
        throw new AppError(400, 'Invalid payment amount');
      }

      // No local existence check here — applyPaymentToTransaction performs the
      // same lookup (and raises the same 404 when the transaction is gone).
      const result = await applyPaymentToTransaction({
        transactionId,
        amount,
        gateway: 'paymongo',
        gatewayRef: piId,
        method,
      });

      if (result.duplicate) {
        return res.json({ received: true, duplicate: true });
      }
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}
