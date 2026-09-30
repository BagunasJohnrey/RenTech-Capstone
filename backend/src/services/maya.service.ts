import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

// Pay with Maya (QRPh). The base URL is chosen by MAYA_ENV so the sandbox keys
// can never be pointed at production (or the reverse). MAYA_BASE_URL overrides
// it entirely — used by the local mock to exercise the integration without
// merchant credentials. Resolved per call so the override is testable.
function baseUrl(): string {
  if (env.MAYA_BASE_URL) return env.MAYA_BASE_URL.replace(/\/+$/, '');
  return env.MAYA_ENV === 'production'
    ? 'https://pg.paymaya.com'
    : 'https://pg-sandbox.paymaya.com';
}

// Maya amounts are integers in centavos at the API boundary; the client only
// ever sees pesos. Every conversion happens here.
const toCentavos = (pesos: number) => Math.round(pesos * 100);
const toPesos = (centavos: number | undefined) => Math.round((centavos ?? 0)) / 100;

// The one shape every gateway returns, so the controller and the client never
// branch on the provider. PayMongo's equivalent lives in paymongo.service.ts.
export type GatewayCharge = {
  gateway: 'maya';
  id: string;
  status: string;
  amount: number;
  currency: 'PHP';
  simulated: boolean;
  redirectUrl?: string;
  qrCodeBody?: string;
  expiresAt?: string;
};

// Maya auth is HTTP Basic with the API key as the username and a blank
// password — same shape as PayMongo, different key.
function auth(key: string): string {
  return `Basic ${Buffer.from(key + ':').toString('base64')}`;
}

async function mayaFetch(path: string, key: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10000), // don't hang on a dead upstream
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth(key),
      ...(init?.headers ?? {}),
    },
  });
  // Never forward the raw upstream body to the client (L7) — status only.
  if (!response.ok) {
    throw new AppError(502, `Payment provider error (${response.status})`);
  }
  return response.json();
}

// Creates a one-time-use QRPh charge. Valid for 1 hour from creation, so the
// caller surfaces `expiresAt` and can offer a fresh QR afterwards.
export async function createQrPayment(
  amount: number,
  description: string,
  opts: {
    transactionId: string;
    requestReferenceNumber: string;
    redirectUrl?: { success?: string; failure?: string; cancel?: string };
  }
): Promise<GatewayCharge> {
  if (!env.MAYA_PUBLIC_KEY) {
    // No gateway configured: return a fake succeeded charge so the booking flow
    // completes end-to-end. The client never treats `simulated` as real. In
    // production this is only reachable behind the explicit MAYA_SIMULATE
    // escape hatch — a silent simulation in prod would confirm unpaid rentals.
    if (env.NODE_ENV === 'production' && !env.MAYA_SIMULATE) {
      throw new AppError(503, 'Payments are not configured. Please contact the boutique.');
    }
    return {
      gateway: 'maya',
      id: `sim_${crypto.randomBytes(8).toString('hex')}`,
      amount,
      currency: 'PHP',
      status: 'succeeded',
      simulated: true,
    };
  }

  const data = await mayaFetch('/payments/v1/qr/payments', env.MAYA_PUBLIC_KEY, {
    method: 'POST',
    body: JSON.stringify({
      totalAmount: { currency: 'PHP', value: toCentavos(amount) },
      description,
      requestReferenceNumber: opts.requestReferenceNumber,
      redirectUrl: opts.redirectUrl,
      metadata: { transactionId: opts.transactionId },
    }),
  });

  return {
    gateway: 'maya',
    id: data.paymentId,
    status: data.paymentStatus ?? 'PENDING',
    amount: toPesos(data.totalAmount?.value) || amount,
    currency: 'PHP',
    simulated: false,
    redirectUrl: data.redirectUrl,
    qrCodeBody: data.qrCodeBody,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}

// The authoritative answer about a payment. This is what the unsigned webhook
// is re-checked against — the webhook payload itself proves nothing.
export async function retrievePayment(paymentId: string): Promise<{
  paymentId: string;
  status: string;
  amount: number;
  receiptNumber?: string;
}> {
  const data = await mayaFetch(`/payments/v1/payments/${encodeURIComponent(paymentId)}`, env.MAYA_SECRET_KEY);
  return {
    paymentId: data.paymentId,
    status: data.paymentStatus,
    amount: toPesos(data.totalAmount?.value),
    receiptNumber: data.receiptNumber,
  };
}

// Cheaper status-only probe (public key) for the polling fallback.
export async function retrievePaymentStatus(paymentId: string): Promise<{ paymentId: string; status: string }> {
  const data = await mayaFetch(
    `/payments/v1/payments/${encodeURIComponent(paymentId)}/status`,
    env.MAYA_PUBLIC_KEY
  );
  return { paymentId: data.paymentId, status: data.paymentStatus };
}

export async function cancelPayment(paymentId: string): Promise<void> {
  await mayaFetch(`/payments/v1/payments/${encodeURIComponent(paymentId)}/cancel`, env.MAYA_SECRET_KEY, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// Maya webhooks are unsigned, so the allowlist is the first line of defence.
// An empty list means "not configured" — the secret-key re-check then carries
// the trust on its own, which is weaker but never silently trusts the payload.
export function isMayaWebhookIpAllowed(ip: string | undefined): boolean {
  const allowed = env.MAYA_WEBHOOK_ALLOWED_IPS;
  if (!allowed.length) return true;
  if (!ip) return false;
  // Express reports IPv4-mapped IPv6 addresses as ::ffff:1.2.3.4.
  return allowed.includes(ip.replace(/^::ffff:/, ''));
}

// Admin "System Integrations" health probe. Authenticates the secret key with a
// harmless lookup (no payment created); 401 = bad key. Never throws.
export async function checkMayaHealth(): Promise<{
  configured: boolean;
  reachable: boolean;
  latencyMs?: number;
  detail: string;
  simulated?: boolean;
}> {
  if (!env.MAYA_SECRET_KEY) {
    if (env.MAYA_SIMULATE) {
      return {
        configured: false,
        reachable: true,
        detail: 'MAYA_SIMULATE=true — test checkout, NO real money moves',
        simulated: true,
      };
    }
    const simOnly = env.NODE_ENV !== 'production';
    return {
      configured: false,
      reachable: simOnly,
      detail: simOnly
        ? 'MAYA_SECRET_KEY is not set — payments are simulated (dev mode)'
        : 'MAYA_SECRET_KEY is not set — payments will fail in production',
      simulated: true,
    };
  }

  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl()}/payments/v1/payments/none`, {
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: auth(env.MAYA_SECRET_KEY) },
    });
    const latencyMs = Date.now() - started;
    if (response.status === 401) {
      return { configured: true, reachable: false, latencyMs, detail: 'Invalid secret key (401)' };
    }
    if (!response.ok) {
      return { configured: true, reachable: false, latencyMs, detail: `Maya API error (${response.status})` };
    }
    return { configured: true, reachable: true, latencyMs, detail: 'Active' };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      latencyMs: Date.now() - started,
      detail: (err as Error)?.message || 'Connection failed',
    };
  }
}