/**
 * Mock Maya QRPh API — lets the whole payment flow be driven end-to-end on a
 * laptop with no merchant credentials.
 *
 *   node --import tsx scripts/mock-maya.mts        (or: npx tsx scripts/mock-maya.mts)
 *
 * Then point the backend at it:
 *
 *   MAYA_BASE_URL=http://127.0.0.1:4599
 *   MAYA_PUBLIC_KEY=pk_mock
 *   MAYA_SECRET_KEY=sk_mock
 *
 * and set the gateway in Settings -> Integrations (or the payment_gateway
 * business rule) to 'maya'.
 *
 * Implements the subset the integration actually uses:
 *   POST /payments/v1/qr/payments                    create a charge
 *   GET  /payments/v1/payments/:id                    authoritative retrieve (secret)
 *   GET  /payments/v1/payments/:id/status             cheap status probe (public)
 *   POST /payments/v1/payments/:id/cancel             cancel
 *
 * Test controls (mock-only, never sent by the backend):
 *   POST /__mock/pay/:id          mark the charge SUCCESS at its full amount
 *   POST /__mock/fail/:id         mark it PAYMENT_FAILED
 *   POST /__mock/expire/:id       mark it PAYMENT_EXPIRED
 *   GET  /__mock/state            dump every charge
 *
 * Amounts are pesos, exactly like the real API — its Amount schema is a float
 * with minimum 0.01, so maya.service.ts runs against the real units.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_MAYA_PORT || 4599);

type Charge = {
  paymentId: string;
  requestReferenceNumber: string;
  amountPesos: number;
  status: 'PENDING' | 'SUCCESS' | 'PAYMENT_FAILED' | 'PAYMENT_EXPIRED' | 'PAYMENT_CANCELLED';
  metadata: Record<string, string> | null;
};

const charges = new Map<string, Charge>();
let seq = 0;

const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
};

const readBody = (req: import('node:http').IncomingMessage) =>
  new Promise<any>((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });

// Mirrors Maya's shape so the service's normalisation is genuinely tested.
const view = (c: Charge) => ({
  paymentId: c.paymentId,
  paymentStatus: c.status,
  requestReferenceNumber: c.requestReferenceNumber,
  metadata: c.metadata ?? undefined,
  receiptNumber: c.status === 'SUCCESS' ? `MOCK-RRN-${c.paymentId}` : undefined,
  totalAmount: { currency: 'PHP', value: c.amountPesos },
});

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  // ---- test controls ----
  let m = path.match(/^\/__mock\/(pay|fail|expire|cancel)\/(.+)$/);
  if (m) {
    const c = charges.get(m[2]);
    if (!c) return json(res, 404, { error: 'unknown charge' });
    c.status = { pay: 'SUCCESS', fail: 'PAYMENT_FAILED', expire: 'PAYMENT_EXPIRED', cancel: 'PAYMENT_CANCELLED' }[m[1]] as Charge['status'];
    console.log(`[mock-maya] ${c.paymentId} -> ${c.status}`);
    return json(res, 200, view(c));
  }
  if (path === '/__mock/state') return json(res, 200, [...charges.values()]);

  // ---- create dynamic QR ----
  if (req.method === 'POST' && path === '/payments/v1/qr/payments') {
    const body = await readBody(req);
    const paymentId = `mock-pay-${++seq}`;
    const charge: Charge = {
      paymentId,
      requestReferenceNumber: String(body.requestReferenceNumber ?? ''),
      amountPesos: Number(body?.totalAmount?.value ?? 0),
      status: 'PENDING',
      metadata: body?.metadata ?? null,
    };
    charges.set(paymentId, charge);
    console.log(`[mock-maya] created ${paymentId} for ₱${charge.amountPesos.toFixed(2)} (${charge.requestReferenceNumber})`);
    return json(res, 200, {
      ...view(charge),
      // Points back at the return page so the redirect can be followed locally.
      redirectUrl: `${body?.redirectUrl?.success ?? '/'}&mayaPaymentId=${paymentId}`,
      qrCodeBody: `MOCK|QRPh|${paymentId}`,
    });
  }

  // ---- retrieve (secret) ----
  m = path.match(/^\/payments\/v1\/payments\/([^/]+)$/);
  if (m && req.method === 'GET') {
    const c = charges.get(m[1]);
    if (!c) return json(res, 400, { code: 'PY0189', message: 'Payment not found' });
    return json(res, 200, view(c));
  }

  // ---- status (public) ----
  m = path.match(/^\/payments\/v1\/payments\/([^/]+)\/status$/);
  if (m && req.method === 'GET') {
    const c = charges.get(m[1]);
    if (!c) return json(res, 400, { code: 'PY0189', message: 'Payment not found' });
    return json(res, 200, { paymentId: c.paymentId, paymentStatus: c.status });
  }

  // ---- cancel ----
  m = path.match(/^\/payments\/v1\/payments\/([^/]+)\/cancel$/);
  if (m && req.method === 'POST') {
    const c = charges.get(m[1]);
    if (!c) return json(res, 400, { code: 'PY0189', message: 'Payment not found' });
    c.status = 'PAYMENT_CANCELLED';
    return json(res, 200, view(c));
  }

  json(res, 404, { error: 'unhandled', path });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-maya] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-maya] point the backend at it with MAYA_BASE_URL=http://127.0.0.1:${PORT}`);
});