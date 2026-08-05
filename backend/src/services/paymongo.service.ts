import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const PAYMONGO_API = 'https://api.paymongo.com/v1';

function getAuthHeader(): string {
  return `Basic ${Buffer.from(env.PAYMONGO_SECRET_KEY + ':').toString('base64')}`;
}

export async function createPaymentIntent(
  amount: number,
  description: string,
  metadata?: Record<string, string>
) {
  if (!env.PAYMONGO_SECRET_KEY) {
    // Simulation mode: no real gateway configured yet. Return a fake succeeded
    // intent so the client can complete the booking flow end-to-end. NEVER
    // allowed in production — this would "confirm" payments that were never made.
    if (env.NODE_ENV === 'production') {
      throw new AppError(503, 'Payments are not configured. Please contact the boutique.');
    }
    return {
      id: `sim_${crypto.randomBytes(8).toString('hex')}`,
      amount,
      currency: 'PHP',
      status: 'succeeded',
      clientKey: `sim_${crypto.randomBytes(8).toString('hex')}`,
      simulated: true,
    };
  }

  const response = await fetch(`${PAYMONGO_API}/payment_intents`, {
    method: 'POST',
    signal: AbortSignal.timeout(10000), // don't hang on a dead upstream
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: Math.round(amount * 100),
          currency: 'PHP',
          description,
          metadata: metadata ?? {},
        },
      },
    }),
  });

  if (!response.ok) {
    // L7: never forward the raw upstream error body to the client.
    throw new AppError(502, `Payment provider error (${response.status})`);
  }

  const data = await response.json() as {
    data: {
      id: string;
      attributes: {
        amount: number;
        currency: string;
        status: string;
        client_key: string;
        metadata: Record<string, string>;
      };
    };
  };

  return {
    id: data.data.id,
    amount: data.data.attributes.amount / 100,
    currency: data.data.attributes.currency,
    status: data.data.attributes.status,
    clientKey: data.data.attributes.client_key,
    metadata: data.data.attributes.metadata,
    simulated: false,
  };
}

export async function retrievePaymentIntent(paymentIntentId: string) {
  if (!env.PAYMONGO_SECRET_KEY) {
    throw new AppError(500, 'PayMongo is not configured');
  }

  const response = await fetch(`${PAYMONGO_API}/payment_intents/${paymentIntentId}`, {
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: getAuthHeader() },
  });

  if (!response.ok) {
    throw new AppError(404, 'Payment intent not found');
  }

  const data = await response.json() as {
    data: {
      id: string;
      attributes: {
        amount: number;
        currency: string;
        status: string;
        payments: { id: string; attributes: { amount: number; status: string; source: string } }[];
      };
    };
  };

  const attrs = data.data.attributes;
  return {
    id: data.data.id,
    amount: attrs.amount / 100,
    currency: attrs.currency,
    status: attrs.status,
    payments: attrs.payments?.map((p: { id: string; attributes: { amount: number; status: string; source: string } }) => ({
      id: p.id,
      amount: p.attributes.amount / 100,
      status: p.attributes.status,
      source: p.attributes.source,
    })) || [],
  };
}

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!env.PAYMONGO_WEBHOOK_SECRET) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', env.PAYMONGO_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  if (expected.length !== signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Admin "System Integrations" health probe — authenticates the secret key via a
// harmless list call (no payment intent created). 401 = bad key. In dev with no
// key the payment path simulates success, so we report that explicitly.
export async function checkPaymongoHealth() {
  if (!env.PAYMONGO_SECRET_KEY) {
    return {
      configured: false,
      reachable: false,
      detail: 'PAYMONGO_SECRET_KEY is not set — payments are simulated (dev mode)',
      simulated: true,
    };
  }
  const started = Date.now();
  try {
    const response = await fetch(`${PAYMONGO_API}/payment_intents?limit=1`, {
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: getAuthHeader() },
    });
    const latencyMs = Date.now() - started;
    if (response.status === 401) {
      return { configured: true, reachable: false, latencyMs, detail: 'Invalid secret key (401)' };
    }
    if (!response.ok) {
      return { configured: true, reachable: false, latencyMs, detail: `PayMongo API error (${response.status})` };
    }
    return { configured: true, reachable: true, latencyMs, detail: 'Active' };
  } catch (err) {
    return { configured: true, reachable: false, latencyMs: Date.now() - started, detail: (err as Error)?.message || 'Connection failed' };
  }
}
