import { Request, Response, NextFunction } from 'express';
import * as paymongoService from '../services/paymongo.service.js';
import { isMayaWebhookIpAllowed, retrievePayment } from '../services/maya.service.js';
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

// Maya (QRPh). Maya webhooks carry NO HMAC signature, so this endpoint cannot
// trust anything it is sent. Two defences, in order:
//
//   1. An optional IP allowlist (Maya publishes its webhook IPs).
//   2. A mandatory re-check: ask Maya, with our secret key, what actually
//      happened to this payment. Only a confirmed SUCCESS with a matching
//      amount credits the booking.
//
// Every path returns 200 quickly because Maya retries only 4 times and then
// gives up. A slow or failing re-check credits nothing — the polling endpoint
// (GET /payments/transaction/:id/status) repairs it from the customer's own
// browser, which is strictly better than a retry storm.
export async function handleMayaWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    if (!isMayaWebhookIpAllowed(req.ip)) {
      throw new AppError(403, 'Webhook source not allowed');
    }

    const body = req.body as {
      id?: string;
      paymentStatus?: string;
      metadata?: { transactionId?: string };
      totalAmount?: { value?: number };
    };

    // Anything uninteresting (a FAILED/EXPIRED/CANCELLED event, a payload we
    // can't correlate) is acknowledged without crediting.
    const ack = () => res.json({ received: true, verified: false });

    if (body.paymentStatus !== 'SUCCESS' || !body.id) return ack();

    // SECURITY (the whole point of this handler): the payload is unsigned, so
    // NOTHING in it chooses which booking gets credited. Not `metadata`, not
    // `receiptNumber`. The binding comes only from the gatewayPaymentId WE
    // stored when we created the charge — so a customer who pays their own
    // downpayment once cannot replay that paymentId against another booking.
    // (The re-check below proves the money arrived; this proves it was OUR money
    // for THIS booking.)
    const tx = await prisma.transaction.findFirst({
      where: { gatewayPaymentId: body.id },
    });
    if (!tx) return ack();

    let verified;
    try {
      verified = await retrievePayment(body.id);
    } catch {
      // Maya is unreachable or erroring. Credit nothing, but still 200.
      return ack();
    }

    if (verified.status !== 'SUCCESS') return ack();

    // The re-check is the ONLY amount we trust — the unsigned payload's own
    // figures are never read. A forged payload can neither inflate a credit
    // (claiming more than Maya received) nor shrink one; whatever Maya says
    // actually landed is what gets recorded, and the balance follows.
    let result;
    try {
      result = await applyPaymentToTransaction({
        transactionId: tx.id,
        amount: verified.amount,
        gateway: 'maya',
        gatewayRef: body.id,
        method: 'maya',
      });
    } catch (err: any) {
      // 400/404 = nothing to do. 409 = a concurrent credit moved totalPaid first,
      // so this delivery lost a race; Maya's retry (or the poller) will land it.
      // All three ack rather than 4xx — a retry storm is worse than a delay.
      if (
        err?.statusCode === 400 || err?.statusCode === 404 || err?.statusCode === 409
      ) return ack();
      throw err;
    }

    if (result.duplicate) {
      return res.json({ received: true, verified: true, duplicate: true });
    }
    res.json({ received: true, verified: true });
  } catch (err) {
    next(err);
  }
}
