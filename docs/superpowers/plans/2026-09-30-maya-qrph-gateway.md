# Maya QRPh Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Maya QRPh the live downpayment gateway for RENTECH, keeping PayMongo selectable via an admin setting, with webhook + polling confirmation that cannot be forged or double-credited.

**Architecture:** Two gateway services (`paymongo.service.ts`, new `maya.service.ts`) both return one normalized `GatewayCharge` shape, so `payments.controller.ts` and the frontend never branch on provider. Selection comes from a `payment_gateway` BusinessRule. Confirmation is webhook-primary (`/api/webhooks/maya`, authenticated by IP allowlist + a secret-key re-check against Maya) with a polling endpoint (`GET /api/payments/transaction/:id/status`) that self-heals a dropped webhook. All crediting lives in one idempotent function, `applyPaymentToTransaction`.

**Tech Stack:** TypeScript 5.8, Express 5, Prisma 6 + PostgreSQL (Supabase), zod, vitest + supertest. Frontend React 18 + Vite, Tailwind. Payment gateway: Maya Pay with Maya API (QRPh).

**Spec:** `docs/superpowers/specs/2026-09-30-maya-qrph-gateway-design.md` — read it before starting; this plan implements it.

---

## Global Constraints

- **Never trust the Maya webhook payload.** Every credit requires `GET /payments/v1/payments/{id}` (secret key) returning `SUCCESS` with a matching amount. This is the entire security model — there is no HMAC.
- **Always answer the Maya webhook `200` within 5 seconds**, including when the re-check fails. A retry storm is worse than a delayed booking; the polling endpoint repairs it.
- **Maya speaks centavos (integers) at the API boundary.** The client only ever sees pesos. Convert at the service edge.
- **New keys are optional and default to simulated mode.** No `MAYA_*` keys ⇒ `simulated: true`. In production without `MAYA_SIMULATE=true`, that is a hard `503` — never a silent simulation.
- **`Payment.gatewayRef` is the idempotency anchor** (`@unique`). Both gateways credit through it; `P2002` means "already applied", not "error".
- **Never forward a raw upstream error body to the client** (existing L7 rule in `paymongo.service.ts:56`). Upstream status code only.
- **All outbound gateway fetches use `AbortSignal.timeout(10000)`**, matching `paymongo.service.ts`.
- **`payment_gateway` defaults to `'paymongo'`.** Shipping this branch must be a no-op for customers until an admin flips the rule.
- **PayMongo must stay byte-for-byte behaviorally unchanged.** `tests/payments.test.ts` and `tests/paymongo-simulate.test.ts` passing untouched is the regression proof.

## Review Focus

Inputs a reasonable person would expect to work, which the spec implies but no listed test would catch. Each has a test pinned in the task that owns the code.

1. **A forged webhook.** Anyone POSTs `PAYMENT_SUCCESS` for an unpaid booking with no Maya involvement → nothing is credited. (Task 4)
2. **A retried payment after QR expiry.** Customer's 1-hour QR lapses, they retry, a *new* charge is created, then the old webhook lands → the old `paymentId` must not credit a second time. (Task 3)
3. **Underpayment.** Webhook claims ₱200 for a ₱2,000 due balance → must not mark the booking paid. (Task 4)
4. **Late payment on a closed rental.** Webhook arrives for a `Returned`/`Cancelled` transaction → must not resurrect it or add to `totalPaid`. (Task 3)
5. **Amount drift between webhook and Maya's authoritative answer** (e.g. promos applied between charge and payment) → re-check governs, payload is discarded. (Task 4)

---

## File Structure

**Backend — created**
| File | Responsibility |
|---|---|
| `backend/src/services/maya.service.ts` | Maya HTTP only. QR creation, retrieve, status, cancel, IP allowlist, health. Knows nothing about Prisma. |
| `backend/src/services/payments.ledger.ts` | The one idempotent crediting path. Called by both webhooks and the polling endpoint. |
| `backend/tests/maya.test.ts` | Maya service + webhook + polling coverage. |

**Backend — modified**
| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | `Payment.gateway`/`gatewayRef`; `Transaction.gateway`/`gatewayPaymentId`. |
| `backend/src/config/env.ts` | 5 `MAYA_*` vars. |
| `backend/src/services/settings.service.ts` | `getPaymentGateway()`. |
| `backend/src/controllers/payments.controller.ts` | Gateway branch in `createPaymentIntent`; new `getPaymentStatus`. |
| `backend/src/controllers/webhooks.controller.ts` | Delegate crediting to the ledger; add `handleMayaWebhook`. |
| `backend/src/routes/webhooks.routes.ts` | `POST /maya`. |
| `backend/src/routes/payments.routes.ts` | `GET /transaction/:transactionId/status`. |
| `backend/src/controllers/settings.controller.ts` | `maya` in the health fan-out. |
| `backend/prisma/seed.ts` | `payment_gateway` rule. |
| `backend/tests/setup.ts` | `payment.deleteMany`, `transaction.findFirst` on `gatewayPaymentId`. |

**Frontend — created**
| File | Responsibility |
|---|---|
| `frontend/src/pages/PaymentReturnView.jsx` | Landing page after Maya redirect. Polls, then resolves. |

**Frontend — modified**
| File | Change |
|---|---|
| `frontend/src/components/CustomerRentalFlow.jsx` | Branch step 2 on `intent.gateway`. |
| `frontend/src/App.jsx` | Mount `/payment-return`. |
| `frontend/src/components/settings/IntegrationsTab.jsx` | Maya row + gateway selector. |
| `frontend/src/services/payments.js`, `hooks/usePayments.js` | `getStatus`. |
| `frontend/src/utils/demoInterceptor.js` | Status route. |
| `frontend/src/components/TermsContent.jsx`, `pages/PrivacyPolicyView.jsx` | Processor-agnostic copy. |

---

## Task 1: Schema, env, and gateway selection

Foundation — the typed Prisma client everything else needs.

**Files:**
- Modify: `backend/prisma/schema.prisma` (Payment model ~line 190, Transaction model line 151)
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/services/settings.service.ts`
- Modify: `backend/prisma/seed.ts`
- Test: `backend/tests/maya.test.ts` (new — the settings assertion lives here so we don't touch existing suites)

**Interfaces:**
- Produces env: `MAYA_PUBLIC_KEY`, `MAYA_SECRET_KEY`, `MAYA_ENV: 'sandbox'|'production'`, `MAYA_SIMULATE: boolean`, `MAYA_WEBHOOK_ALLOWED_IPS: string[]`
- Produces: `getPaymentGateway(): Promise<'paymongo' | 'maya'>` from `settings.service.ts` — never throws, falls back to `'paymongo'`
- Produces Prisma fields: `Payment.gateway: string`, `Payment.gatewayRef: string?`, `Transaction.gateway: string?`, `Transaction.gatewayPaymentId: string?`

- [ ] **Step 1: Stop the backend if it is running**

`npx prisma generate` fails with EPERM while the dev server holds the engine DLL. Check with `Get-Process node` / ask the user if unsure.

- [ ] **Step 2: Edit `schema.prisma`**

In `model Payment`, replace `paymongoPiId String? @unique @map("paymongo_pi_id")` with:

```prisma
  gateway    String  @default("paymongo")
  gatewayRef String? @unique @map("gateway_ref")
```

In `model Transaction`, replace `paymentIntentId String? @map("payment_intent_id")` with:

```prisma
  gateway          String? @map("gateway")
  gatewayPaymentId String? @map("gateway_payment_id")
```

- [ ] **Step 3: Push the migration**

The `pgbouncer` transaction-mode pooler hangs on the advisory lock, so DDL must use the direct host. Try in order and stop at the first that succeeds:

```bash
# a) the supported path — DIRECT_URL is already wired into schema.prisma
npm run db:push

# b) if (a) hangs or the direct host is unreachable (IPv6-only from this machine),
#    apply the DDL by hand and skip Prisma's drop/create dance:
#      ALTER TABLE payments ADD COLUMN gateway text NOT NULL DEFAULT 'paymongo';
#      ALTER TABLE payments ADD COLUMN gateway_ref text;
#      UPDATE payments SET gateway_ref = paymongo_pi_id WHERE paymongo_pi_id IS NOT NULL;
#      ALTER TABLE payments DROP COLUMN paymongo_pi_id;
#      ALTER TABLE payments ADD CONSTRAINT payments_gateway_ref_key UNIQUE (gateway_ref);
#      ALTER TABLE transactions ADD COLUMN gateway text;
#      ALTER TABLE transactions ADD COLUMN gateway_payment_id text;
#      ALTER TABLE transactions RENAME COLUMN payment_intent_id TO gateway_payment_id;
```

Verify no drift afterwards:

```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: exit 0. Non-zero means the DB and schema disagree — fix before continuing.

- [ ] **Step 4: Regenerate the client**

```bash
npx prisma generate
```

- [ ] **Step 5: Add the env vars**

Append to `env` in `backend/src/config/env.ts`:

```ts
  // Maya Pay with Maya (QRPh). Empty keys ⇒ simulated payments; a production
  // deploy without MAYA_SIMULATE=true hard-fails instead of faking a payment.
  // MAYA_WEBHOOK_ALLOWED_IPS is Maya's published webhook IPs; empty ⇒ the
  // allowlist is skipped and the secret-key re-check carries the trust alone.
  MAYA_PUBLIC_KEY: process.env.MAYA_PUBLIC_KEY || '',
  MAYA_SECRET_KEY: process.env.MAYA_SECRET_KEY || '',
  MAYA_ENV: process.env.MAYA_ENV === 'production' ? 'production' : 'sandbox',
  MAYA_SIMULATE: process.env.MAYA_SIMULATE === 'true',
  MAYA_WEBHOOK_ALLOWED_IPS: (process.env.MAYA_WEBHOOK_ALLOWED_IPS || '')
    .split(',').map((ip) => ip.trim()).filter(Boolean),
```

- [ ] **Step 6: Write the failing test**

Create `backend/tests/maya.test.ts` with this header and first block — it mocks `env` so the service (added in Task 2) loads deterministic keys:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../src/config/env.js', () => ({
  env: {
    MAYA_PUBLIC_KEY: 'pk_test_mock',
    MAYA_SECRET_KEY: 'sk_test_mock',
    MAYA_ENV: 'sandbox',
    MAYA_SIMULATE: false,
    MAYA_WEBHOOK_ALLOWED_IPS: [],
    PAYMONGO_SECRET_KEY: '',
    PAYMONGO_SIMULATE: true,
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:5173',
  },
}));

describe('getPaymentGateway', () => {
  it('falls back to paymongo when the rule is unset', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([]);
    const { getPaymentGateway } = await import('../src/services/settings.service.js');
    expect(await getPaymentGateway()).toBe('paymongo');
  });

  it('returns maya when the rule says so', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([{ key: 'payment_gateway', value: 'maya' }]);
    const { getPaymentGateway } = await import('../src/services/settings.service.js');
    expect(await getPaymentGateway()).toBe('maya');
  });

  it('falls back to paymongo for an unrecognized gateway value', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([{ key: 'payment_gateway', value: 'stripe' }]);
    const { getPaymentGateway } = await import('../src/services/settings.service.js');
    expect(await getPaymentGateway()).toBe('paymongo');
  });
});
```

- [ ] **Step 7: Run to verify it fails**

```bash
npx vitest run tests/maya.test.ts
```

Expected: FAIL — `getPaymentGateway is not a function`.

- [ ] **Step 8: Implement `getPaymentGateway`**

Append to `backend/src/services/settings.service.ts`:

```ts
// Which payment gateway new charges use. Unknown/absent values fall back to
// 'paymongo' so a typo in the rule can't take the booking flow down.
export async function getPaymentGateway(): Promise<'paymongo' | 'maya'> {
  const rules = await getBusinessRules();
  return rules.payment_gateway === 'maya' ? 'maya' : 'paymongo';
}
```

- [ ] **Step 9: Seed the rule**

Add to the rules array in `backend/prisma/seed.ts`:

```ts
{ key: 'payment_gateway', value: 'paymongo', description: 'Gateway for booking downpayments: paymongo | maya' },
```

- [ ] **Step 10: Run to verify it passes**

```bash
npx vitest run tests/maya.test.ts
```

Expected: 3 passed.

- [ ] **Step 11: Typecheck + commit**

```bash
npx tsc --noEmit
git add backend/prisma backend/src/config/env.ts backend/src/services/settings.service.ts backend/tests/maya.test.ts
git commit -m "feat(payments): schema + env + gateway selection for Maya QRPh"
```

---

## Task 2: `maya.service.ts`

Pure HTTP layer, fully tested against mocked `fetch`.

**Files:**
- Create: `backend/src/services/maya.service.ts`
- Test: `backend/tests/maya.test.ts` (append)

**Interfaces:**
- Produces: `createQrPayment(amount: number, description: string, opts: { transactionId: string; requestReferenceNumber: string; redirectUrl?: { success?: string; failure?: string; cancel?: string } }) => Promise<GatewayCharge>`
- Produces: `retrievePayment(paymentId: string) => Promise<{ paymentId: string; status: string; amount: number; receiptNumber?: string }>`
- Produces: `retrievePaymentStatus(paymentId: string) => Promise<{ paymentId: string; status: string }>`
- Produces: `cancelPayment(paymentId: string) => Promise<void>`
- Produces: `isMayaWebhookIpAllowed(ip: string | undefined): boolean` — `true` when `MAYA_WEBHOOK_ALLOWED_IPS` is empty
- Produces: `checkMayaHealth() => Promise<{ configured: boolean; reachable: boolean; latencyMs?: number; detail: string; simulated?: boolean }>`
- Consumes: env vars from Task 1

`GatewayCharge` is defined in this file and imported by Tasks 3-4:

```ts
export type GatewayCharge = {
  gateway: 'maya';
  id: string;
  status: string;
  amount: number;       // pesos
  currency: 'PHP';
  simulated: boolean;
  redirectUrl?: string;
  qrCodeBody?: string;
  expiresAt?: string;   // ISO, created + 1h
};
```

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/maya.test.ts`:

```ts
import { createQrPayment, retrievePayment, retrievePaymentStatus, cancelPayment, isMayaWebhookIpAllowed, checkMayaHealth } from '../src/services/maya.service.js';

const SANDBOX = 'https://pg-sandbox.paymaya.com';

describe('createQrPayment', () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it('converts pesos to centavos and returns the normalized charge', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        paymentId: 'pay-maya-1',
        redirectUrl: 'https://pg-sandbox.paymaya.com/pay/pay-maya-1',
        qrCodeBody: 'https://paymaya.com/qr/pay-maya-1',
        totalAmount: { currency: 'PHP', value: 250000 },
      }),
    });

    const charge = await createQrPayment(2500, 'Downpayment TX-1001', {
      transactionId: 'tx-1',
      requestReferenceNumber: 'TX-1001',
      redirectUrl: { success: 'http://localhost:5173/payment-return?tx=tx-1' },
    });

    expect(charge).toMatchObject({ gateway: 'maya', id: 'pay-maya-1', amount: 2500, simulated: false });
    expect(charge.redirectUrl).toBe('https://pg-sandbox.paymaya.com/pay/pay-maya-1');
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.totalAmount).toEqual({ currency: 'PHP', value: 250000 });
    expect(body.redirectUrl.success).toBe('http://localhost:5173/payment-return?tx=tx-1');
    expect((global.fetch as any).mock.calls[0][0]).toBe(`${SANDBOX}/payments/v1/qr/payments`);
  });

  it('sets expiresAt one hour out', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'p2', redirectUrl: 'u', totalAmount: { value: 20000 } }),
    });
    const charge = await createQrPayment(200, 'd', { transactionId: 't', requestReferenceNumber: 'r' });
    const delta = new Date(charge.expiresAt!).getTime() - Date.now();
    expect(delta).toBeGreaterThan(59 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('does not leak the upstream error body', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('Maya internal detail') });
    await expect(createQrPayment(200, 'd', { transactionId: 't', requestReferenceNumber: 'r' }))
      .rejects.toThrow('Payment provider error (400)');
  });

  it('returns a simulated charge when no key is configured', async () => {
    const { env } = await import('../src/config/env.js');
    env.MAYA_PUBLIC_KEY = '';
    const charge = await createQrPayment(200, 'd', { transactionId: 't', requestReferenceNumber: 'r' });
    expect(charge.simulated).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    env.MAYA_PUBLIC_KEY = 'pk_test_mock';
  });
});

describe('retrievePayment', () => {
  beforeEach(() => { global.fetch = vi.fn(); });

  it('normalizes SUCCESS and the amount', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'p1', paymentStatus: 'SUCCESS', totalAmount: { value: 250000 }, receiptNumber: 'RRN123' }),
    });
    expect(await retrievePayment('p1')).toEqual({ paymentId: 'p1', status: 'SUCCESS', amount: 2500, receiptNumber: 'RRN123' });
    expect((global.fetch as any).mock.calls[0][0]).toBe(`${SANDBOX}/payments/v1/payments/p1`);
  });
});

describe('retrievePaymentStatus', () => {
  it('returns the status from the public status endpoint', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'p1', paymentStatus: 'PENDING' }),
    });
    expect(await retrievePaymentStatus('p1')).toEqual({ paymentId: 'p1', status: 'PENDING' });
    expect((global.fetch as any).mock.calls[0][0]).toBe(`${SANDBOX}/payments/v1/payments/p1/status`);
  });
});

describe('cancelPayment', () => {
  it('posts to the cancel endpoint', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    await cancelPayment('p1');
    expect((global.fetch as any).mock.calls[0][0]).toBe(`${SANDBOX}/payments/v1/payments/p1/cancel`);
    expect((global.fetch as any).mock.calls[0][1].method).toBe('POST');
  });
});

describe('isMayaWebhookIpAllowed', () => {
  it('allows everything when the allowlist is empty', async () => {
    const { env } = await import('../src/config/env.js');
    env.MAYA_WEBHOOK_ALLOWED_IPS = [];
    expect(isMayaWebhookIpAllowed('1.2.3.4')).toBe(true);
    expect(isMayaWebhookIpAllowed(undefined)).toBe(true);
  });

  it('rejects an ip outside a configured allowlist', async () => {
    const { env } = await import('../src/config/env.js');
    env.MAYA_WEBHOOK_ALLOWED_IPS = ['5.6.7.8'];
    expect(isMayaWebhookIpAllowed('1.2.3.4')).toBe(false);
    expect(isMayaWebhookIpAllowed('5.6.7.8')).toBe(true);
    env.MAYA_WEBHOOK_ALLOWED_IPS = [];
  });
});

describe('checkMayaHealth', () => {
  it('reports a 401 as an invalid key', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const health = await checkMayaHealth();
    expect(health).toMatchObject({ configured: true, reachable: false });
    expect(health.detail).toMatch(/401/);
  });

  it('reports reachable on a 200', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    expect(await checkMayaHealth()).toMatchObject({ configured: true, reachable: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/maya.test.ts
```

Expected: FAIL — cannot resolve `../src/services/maya.service.js`.

- [ ] **Step 3: Implement `maya.service.ts`**

Create `backend/src/services/maya.service.ts`. Follow `paymongo.service.ts` exactly: `Buffer.from(key + ':').toString('base64')` for Basic auth, `AbortSignal.timeout(10000)` on every fetch, `AppError` with the upstream status only.

```ts
import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const BASE = env.MAYA_ENV === 'production'
  ? 'https://pg.paymaya.com'
  : 'https://pg-sandbox.paymaya.com';

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

function auth(key: string): string {
  return `Basic ${Buffer.from(key + ':').toString('base64')}`;
}

async function mayaFetch(path: string, key: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth(key),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new AppError(502, `Payment provider error (${response.status})`);
  return response.json() as Promise<any>;
}
```

`createQrPayment`: when `!env.MAYA_PUBLIC_KEY`, mirror `paymongo.service.ts:16-34` — `503` in production unless `MAYA_SIMULATE`, else return `{ gateway:'maya', id: 'sim_<hex>', status: 'succeeded', amount, currency:'PHP', simulated: true }` without calling `fetch`. Otherwise `POST /payments/v1/qr/payments` with body:

```ts
{
  totalAmount: { currency: 'PHP', value: Math.round(amount * 100) },
  requestReferenceNumber: opts.requestReferenceNumber,
  description,
  redirectUrl: opts.redirectUrl,
  metadata: { transactionId: opts.transactionId },
}
```

and return `{ gateway: 'maya', id: data.paymentId, status: 'PENDING', amount: Math.round(data.totalAmount.value) / 100, currency: 'PHP', simulated: false, redirectUrl: data.redirectUrl, qrCodeBody: data.qrCodeBody, expiresAt: new Date(Date.now() + 3600_000).toISOString() }`.

`retrievePayment(paymentId)` → `GET /payments/v1/payments/{paymentId}` with the **secret** key, returning `{ paymentId: data.paymentId, status: data.paymentStatus, amount: Math.round(data.totalAmount?.value ?? 0) / 100, receiptNumber: data.receiptNumber }`.

`retrievePaymentStatus(paymentId)` → `GET /payments/v1/payments/{paymentId}/status` with the **public** key, returning `{ paymentId: data.paymentId, status: data.paymentStatus }`.

`cancelPayment(paymentId)` → `POST /payments/v1/payments/{paymentId}/cancel` with the secret key.

`isMayaWebhookIpAllowed(ip)`:

```ts
export function isMayaWebhookIpAllowed(ip: string | undefined): boolean {
  const allowed = env.MAYA_WEBHOOK_ALLOWED_IPS;
  if (!allowed.length) return true;          // unset ⇒ re-check carries the trust
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, '');
  return allowed.includes(normalized);
}
```

`checkMayaHealth()` → when `!env.MAYA_SECRET_KEY`, return `{ configured: false, reachable: !!(env.NODE_ENV === 'production' && !env.MAYA_SIMULATE), detail: env.MAYA_SIMULATE ? 'MAYA_SIMULATE=true — test checkout, NO real money moves' : 'MAYA_SECRET_KEY is not set — payments are simulated (dev mode)', simulated: true }`. Otherwise time a harmless `GET /payments/v1/payments/none` and map: `401` → `detail: 'Invalid secret key (401)'`; non-OK → ``detail: `Maya API error (${status})` ``; OK → `detail: 'Active'`; thrown → `detail: err.message`. All failures set `reachable: false` and never throw.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run tests/maya.test.ts
```

Expected: all passing.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add backend/src/services/maya.service.ts backend/tests/maya.test.ts
git commit -m "feat(payments): Maya QRPh gateway service"
```

---

## Task 3: The idempotent ledger

The single crediting path. Extracted from `webhooks.controller.ts:73-114` with the two derivations promoted to parameters.

**Files:**
- Create: `backend/src/services/payments.ledger.ts`
- Modify: `backend/src/controllers/webhooks.controller.ts` (delegate)
- Test: `backend/tests/maya.test.ts` (append)

**Interfaces:**
- Consumes: Prisma fields from Task 1
- Produces: `applyPaymentToTransaction(input: { transactionId: string; amount: number; gateway: 'paymongo' | 'maya'; gatewayRef: string; method: 'gcash' | 'card' | 'maya' }): Promise<{ duplicate: boolean; totalPaid: number; balance: number }>`
  - `duplicate: true` ⇒ already applied (existing row by `gatewayRef`, or a `P2002` race). Caller returns `200 {received:true, duplicate:true}` and **must not** recompute balances.
  - **Review Focus #4:** a payment for a `Returned`/`Cancelled` transaction returns `{ duplicate: false, skipped: true }`-shaped rejection — implement as: if `tx.status === 'Returned' || tx.status === 'Cancelled'`, throw `AppError(400, 'Transaction is already closed')` before creating the `Payment`. The webhook layer converts that to `200 { received: true, ignored: true }`.
  - **Review Focus #2:** the `gatewayRef` unique lookup happens *before* the create, so a superseded QR whose webhook lands late is recognized as already-handled and credited zero additional times.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/maya.test.ts`:

```ts
import { applyPaymentToTransaction } from '../src/services/payments.ledger.js';

const openTx = {
  id: 'tx-1', txNumber: 1001, status: 'Active',
  rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, balance: 5000,
};

describe('applyPaymentToTransaction', () => {
  it('credits the payment and recomputes the balance', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(openTx);
    prisma.payment.findUnique.mockResolvedValueOnce(null);

    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 2000, gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya',
    });

    expect(result).toMatchObject({ duplicate: false, totalPaid: 2000, balance: 3000 });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya', type: 'downpayment' }),
    }));
    expect(prisma.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalPaid: 2000, balance: 3000, gatewayPaymentId: 'pay-maya-1' }),
    }));
  });

  it('classifies a full payment', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(openTx);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    await applyPaymentToTransaction({ transactionId: 'tx-1', amount: 5000, gateway: 'maya', gatewayRef: 'p-full', method: 'maya' });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'full_payment' }),
    }));
  });

  it('is idempotent for an already-recorded gatewayRef', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(openTx);
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'pay-existing', gatewayRef: 'pay-maya-1' });

    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 2000, gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya',
    });

    expect(result.duplicate).toBe(true);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('treats a P2002 race as a duplicate', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(openTx);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    prisma.payment.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 2000, gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya',
    });
    expect(result.duplicate).toBe(true);
  });

  it('refuses a payment on a closed transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...openTx, status: 'Returned' });
    await expect(applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 2000, gateway: 'maya', gatewayRef: 'pay-late', method: 'maya',
    })).rejects.toThrow(/already closed/);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('includes latePenalty and damageFee in the balance', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...openTx, latePenalty: 300, damageFee: 500 });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 1000, gateway: 'maya', gatewayRef: 'p-3', method: 'maya',
    });
    expect(result).toMatchObject({ totalPaid: 1000, balance: 4800 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/maya.test.ts
```

Expected: FAIL — cannot resolve `payments.ledger.js`.

- [ ] **Step 3: Implement `payments.ledger.ts`**

Create `backend/src/services/payments.ledger.ts`. Lift the body of `webhooks.controller.ts:73-114` and change two things: the `method`/`type` derivations become parameters, and the idempotency lookup moves to `findUnique({ where: { gatewayRef } })`.

```ts
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { clearDataCache } from '../utils/ttlCache.js';

export async function applyPaymentToTransaction(input: {
  transactionId: string;
  amount: number;
  gateway: 'paymongo' | 'maya';
  gatewayRef: string;
  method: 'gcash' | 'card' | 'maya';
}): Promise<{ duplicate: boolean; totalPaid: number; balance: number }> {
  const tx = await prisma.transaction.findUnique({ where: { id: input.transactionId } });
  if (!tx) throw new AppError(404, 'Transaction not found');
  if (tx.status === 'Returned' || tx.status === 'Cancelled') {
    throw new AppError(400, 'Transaction is already closed');
  }

  const existing = await prisma.payment.findUnique({ where: { gatewayRef: input.gatewayRef } });
  if (existing) {
    return { duplicate: true, totalPaid: tx.totalPaid, balance: tx.balance };
  }

  try {
    await prisma.payment.create({
      data: {
        transactionId: input.transactionId,
        amount: input.amount,
        method: input.method,
        type: input.amount >= tx.rentalFee ? 'full_payment' : 'downpayment',
        gateway: input.gateway,
        gatewayRef: input.gatewayRef,
        status: 'succeeded',
      },
    });
  } catch (err: any) {
    // Concurrent deliveries both pass the findUnique above; the unique
    // gatewayRef constraint makes the loser throw P2002.
    if (err?.code === 'P2002') {
      return { duplicate: true, totalPaid: tx.totalPaid, balance: tx.balance };
    }
    throw err;
  }

  const totalPaid = tx.totalPaid + input.amount;
  const balance = Math.max(0, tx.rentalFee + tx.latePenalty + tx.damageFee - totalPaid);

  await prisma.transaction.update({
    where: { id: input.transactionId },
    data: { totalPaid, balance, gatewayPaymentId: input.gatewayRef, gateway: input.gateway },
  });

  await createAuditLog({
    action: 'update',
    entity: 'transaction',
    entityId: input.transactionId,
    newValue: { paymentReceived: input.amount, totalPaid, balance },
  });

  clearDataCache();

  return { duplicate: false, totalPaid, balance };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run tests/maya.test.ts
```

Expected: all passing.

- [ ] **Step 5: Delegate from the PayMongo webhook**

In `backend/src/controllers/webhooks.controller.ts`, replace the block from `const existing = await prisma.payment.findUnique(...)` through `clearDataCache();` (lines 67-114) with:

```ts
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
```

Add `import { applyPaymentToTransaction } from '../services/payments.ledger.js';`. Remove the now-unused `prisma`, `createAuditLog`, and `clearDataCache` imports **only if** nothing else in the file uses them (`prisma.transaction.findUnique` at line 61 still does).

- [ ] **Step 6: Prove PayMongo didn't change**

```bash
npx vitest run tests/payments.test.ts tests/paymongo-simulate.test.ts
```

Expected: all passing, unchanged. If `payments.test.ts` fails, the delegation changed behavior — fix before continuing.

- [ ] **Step 7: Typecheck + commit**

```bash
npx tsc --noEmit
git add backend/src/services/payments.ledger.ts backend/src/controllers/webhooks.controller.ts backend/tests/maya.test.ts
git commit -m "refactor(payments): extract idempotent crediting into a shared ledger"
```

---

## Task 4: `POST /api/webhooks/maya`

**Files:**
- Modify: `backend/src/controllers/webhooks.controller.ts` (add `handleMayaWebhook`)
- Modify: `backend/src/routes/webhooks.routes.ts`
- Test: `backend/tests/maya.test.ts` (append)

**Interfaces:**
- Consumes: `retrievePayment`, `isMayaWebhookIpAllowed` (Task 2), `applyPaymentToTransaction` (Task 3), `Transaction.gatewayPaymentId` (Task 1)
- Produces route: `POST /api/webhooks/maya` — unauthenticated, always `200` on any recognized event

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/maya.test.ts`:

```ts
import routes from '../src/routes/index.js';
import webhookRoutes from '../src/routes/webhooks.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

const webhookApp = express();
webhookApp.use('/api/webhooks', express.json(), webhookRoutes);
webhookApp.use(errorHandler);

const txOpen = {
  id: 'tx-1', txNumber: 1001, status: 'Active', customerId: 'customer-id-111',
  rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, balance: 5000,
};

const successPayload = {
  id: 'pay-maya-1',
  paymentStatus: 'SUCCESS',
  receiptNumber: 'RRN123',
  metadata: { transactionId: 'tx-1' },
};

function mockMayaRetrieve(over: Record<string, any> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ paymentId: 'pay-maya-1', paymentStatus: 'SUCCESS', totalAmount: { value: 200000 }, ...over }),
  });
}

describe('POST /api/webhooks/maya', () => {
  it('credits a verified SUCCESS webhook', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    global.fetch = mockMayaRetrieve();

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: true });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'maya', gatewayRef: 'pay-maya-1', method: 'maya', amount: 2000 }),
    }));
  });

  it('REFUSES a forged SUCCESS the secret-key re-check does not confirm', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    global.fetch = mockMayaRetrieve({ paymentStatus: 'PENDING' });

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: false });
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('REFUSES an amount the re-check disagrees with (Review Focus #3)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    global.fetch = mockMayaRetrieve({ totalAmount: { value: 200 } }); // ₱2, not ₱2000

    const res = await request(webhookApp).post('/api/webhooks/maya')
      .send({ ...successPayload, totalAmount: { value: 200000 } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: false });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('uses the re-check amount, not the payload amount (Review Focus #5)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    global.fetch = mockMayaRetrieve({ totalAmount: { value: 150000 } });

    await request(webhookApp).post('/api/webhooks/maya')
      .send({ ...successPayload, totalAmount: { value: 999999 } });

    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 1500 }),
    }));
  });

  it('answers 200 without crediting when the re-check itself fails', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: false });
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('reports duplicate for a replayed webhook', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'pay-existing', gatewayRef: 'pay-maya-1' });
    global.fetch = mockMayaRetrieve();

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);
    expect(res.body).toMatchObject({ received: true, duplicate: true });
  });

  it('ignores a non-SUCCESS event without calling Maya', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    global.fetch = vi.fn();

    const res = await request(webhookApp).post('/api/webhooks/maya')
      .send({ id: 'pay-maya-1', paymentStatus: 'PAYMENT_FAILED' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: false });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('403s a source outside a configured IP allowlist', async () => {
    const { env } = await import('../src/config/env.js');
    const { prisma } = await import('../src/config/database.js');
    env.MAYA_WEBHOOK_ALLOWED_IPS = ['203.0.113.9'];
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);

    const res = await request(webhookApp).post('/api/webhooks/maya').send(successPayload);

    expect(res.status).toBe(403);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    env.MAYA_WEBHOOK_ALLOWED_IPS = [];
  });

  it('resolves the transaction by gatewayPaymentId when metadata is absent', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findFirst.mockResolvedValueOnce({ ...txOpen, gatewayPaymentId: 'pay-maya-1' });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    global.fetch = mockMayaRetrieve();

    const res = await request(webhookApp).post('/api/webhooks/maya')
      .send({ id: 'pay-maya-1', paymentStatus: 'SUCCESS', totalAmount: { value: 200000 } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, verified: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/maya.test.ts
```

Expected: FAIL — 404, no route for `/api/webhooks/maya`.

- [ ] **Step 3: Implement `handleMayaWebhook`**

Append to `backend/src/controllers/webhooks.controller.ts`:

```ts
export async function handleMayaWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const { isMayaWebhookIpAllowed, retrievePayment } = await import('../services/maya.service.js');
    const { prisma } = await import('../config/database.js');
    const { applyPaymentToTransaction } = await import('../services/payments.ledger.js');

    if (!isMayaWebhookIpAllowed(req.ip)) {
      throw new AppError(403, 'Webhook source not allowed');
    }

    const body = req.body as {
      id?: string;
      paymentStatus?: string;
      metadata?: { transactionId?: string };
      totalAmount?: { value?: number };
    };

    const ack = (extra: Record<string, unknown>) => res.json({ received: true, verified: false, ...extra });

    if (body.paymentStatus !== 'SUCCESS' || !body.id) return ack({});

    const tx = body.metadata?.transactionId
      ? await prisma.transaction.findUnique({ where: { id: body.metadata.transactionId } })
      : await prisma.transaction.findFirst({ where: { gatewayPaymentId: body.id } });

    if (!tx) return ack({});

    // Maya webhooks are unsigned, so the payload proves nothing. Re-ask Maya
    // with our secret key; only a confirmed SUCCESS with a matching amount
    // credits the booking. A re-check failure credits nothing but still 200s
    // so Maya doesn't retry-storm — the polling endpoint repairs it.
    let verified;
    try {
      verified = await retrievePayment(body.id);
    } catch {
      return ack({});
    }
    if (verified.status !== 'SUCCESS') return ack({});

    const payloadAmount = (body.totalAmount?.value ?? 0) / 100;
    if (payloadAmount > 0 && Math.abs(verified.amount - payloadAmount) > 0.01) return ack({});

    const result = await applyPaymentToTransaction({
      transactionId: tx.id,
      amount: verified.amount,
      gateway: 'maya',
      gatewayRef: body.id,
      method: 'maya',
    });

    if (result.duplicate) return res.json({ received: true, verified: true, duplicate: true });
    res.json({ received: true, verified: true });
  } catch (err) {
    next(err);
  }
}
```

Note the `AppError(400, 'Transaction is already closed')` thrown by the ledger for a closed rental propagates to `errorHandler`. The `verify-email`-style contract says the webhook must always 200 — wrap that one call:

```ts
    let result;
    try {
      result = await applyPaymentToTransaction({ /* … */ });
    } catch (err: any) {
      if (err?.status === 400 || err?.status === 404) return ack({});
      throw err;
    }
```

Use that form, not the bare call.

- [ ] **Step 4: Register the route**

In `backend/src/routes/webhooks.routes.ts`, add:

```ts
router.post('/maya', webhooksController.handleMayaWebhook);
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run tests/maya.test.ts
```

Expected: all passing, including the four Review Focus tests.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add backend/src/controllers/webhooks.controller.ts backend/src/routes/webhooks.routes.ts backend/tests/maya.test.ts
git commit -m "feat(payments): Maya webhook with IP allowlist and secret-key re-check"
```

---

## Task 5: Charging through the selected gateway, and the polling status endpoint

**Files:**
- Modify: `backend/src/controllers/payments.controller.ts`
- Modify: `backend/src/routes/payments.routes.ts`
- Test: `backend/tests/maya.test.ts` (append)

**Interfaces:**
- Consumes: `getPaymentGateway` (T1), `createQrPayment`/`retrievePaymentStatus` (T2), `applyPaymentToTransaction` (T3)
- Produces: `GET /api/payments/transaction/:transactionId/status` → `{ status: 'pending'|'succeeded'|'failed'|'expired'; totalPaid: number; balance: number; gateway: string }`
- Route note: `GET /:id` exists today. `/transaction/:transactionId/status` is three segments so it cannot collide; register it before `/:id` anyway.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/maya.test.ts`:

```ts
describe('POST /api/payments/create-intent with gateway=maya', () => {
  it('returns a Maya redirect URL and stores the payment ref', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValue([{ key: 'payment_gateway', value: 'maya' }]);
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    prisma.transaction.update.mockResolvedValueOnce({});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        paymentId: 'pay-maya-9',
        redirectUrl: 'https://pg-sandbox.paymaya.com/pay/pay-maya-9',
        qrCodeBody: 'https://paymaya.com/qr/pay-maya-9',
        totalAmount: { currency: 'PHP', value: 200000 },
      }),
    });

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', 'Bearer customer-token')
      .send({ transactionId: 'tx-1', amount: 2000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gateway: 'maya', paymentId: 'pay-maya-9' });
    expect(res.body.redirectUrl).toContain('pay-maya-9');
    expect(res.body.simulated).toBe(false);
    expect(prisma.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'maya', gatewayPaymentId: 'pay-maya-9' }),
    }));
  });

  it('still enforces the [min, due] payment bounds under maya', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValue([{ key: 'payment_gateway', value: 'maya' }]);
    prisma.transaction.findUnique.mockResolvedValueOnce(txOpen);
    global.fetch = vi.fn();

    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', 'Bearer customer-token')
      .send({ transactionId: 'tx-1', amount: 100 });

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/payments/transaction/:id/status', () => {
  it('reports succeeded without calling Maya when the balance is settled', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, totalPaid: 2000, balance: 3000 });
    global.fetch = vi.fn();

    const res = await request(app)
      .get('/api/payments/transaction/tx-1/status')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'succeeded', totalPaid: 2000, balance: 3000 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('credits and reports succeeded when Maya confirms a payment the webhook missed', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, gateway: 'maya', gatewayPaymentId: 'pay-maya-7' });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'pay-maya-7', paymentStatus: 'SUCCESS', totalAmount: { value: 200000 } }),
    });

    const res = await request(app)
      .get('/api/payments/transaction/tx-1/status')
      .set('Authorization', 'Bearer customer-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'succeeded', totalPaid: 2000, balance: 3000 });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gatewayRef: 'pay-maya-7', amount: 2000 }),
    }));
  });

  it('reports pending while Maya is still pending', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, gateway: 'maya', gatewayPaymentId: 'pay-maya-8' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'pay-maya-8', paymentStatus: 'PENDING' }),
    });

    const res = await request(app)
      .get('/api/payments/transaction/tx-1/status')
      .set('Authorization', 'Bearer customer-token');

    expect(res.body).toMatchObject({ status: 'pending', totalPaid: 0 });
  });

  it('reports failed on PAYMENT_FAILED', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, gateway: 'maya', gatewayPaymentId: 'pay-maya-x' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'pay-maya-x', paymentStatus: 'PAYMENT_FAILED' }),
    });

    const res = await request(app).get('/api/payments/transaction/tx-1/status').set('Authorization', 'Bearer customer-token');
    expect(res.body).toMatchObject({ status: 'failed' });
  });

  it('reports expired when the one-time QR has lapsed', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, gateway: 'maya', gatewayPaymentId: 'pay-maya-y' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ paymentId: 'pay-maya-y', paymentStatus: 'PAYMENT_EXPIRED' }),
    });

    const res = await request(app).get('/api/payments/transaction/tx-1/status').set('Authorization', 'Bearer customer-token');
    expect(res.body).toMatchObject({ status: 'expired' });
  });

  it('403s another customer\'s transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...txOpen, customerId: 'someone-else' });
    const res = await request(app).get('/api/payments/transaction/tx-1/status').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(403);
  });

  it('404s an unknown transaction', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/payments/transaction/nope/status').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/maya.test.ts
```

Expected: FAIL — create-intent still returns a PayMongo shape; the status route 404s.

- [ ] **Step 3: Branch `createPaymentIntent` on the gateway**

In `backend/src/controllers/payments.controller.ts`, after the existing amount-bounds block (line 46), insert the gateway branch. Keep every existing validation above it untouched — the bounds, ownership, and closed-transaction checks run for both gateways.

```ts
    const gateway = await getPaymentGateway();

    if (gateway === 'maya') {
      const { createQrPayment } = await import('../services/maya.service.js');
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
```

Add imports for `getPaymentGateway` and `env`. Leave the existing `paymongoService.createPaymentIntent` path below it untouched, but add `gateway: 'paymongo'` to its response `res.json({...})` so the client always gets a `gateway` field.

- [ ] **Step 4: Implement `getPaymentStatus`**

Append to `backend/src/controllers/payments.controller.ts`:

```ts
export async function getPaymentStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const transactionId = String(req.params.transactionId);

    const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new AppError(404, 'Transaction not found');
    if (req.user.role === 'Customer' && tx.customerId !== req.user.id) {
      throw new AppError(403, 'Not your transaction');
    }

    const settled = tx.totalPaid > 0;
    if (settled || tx.gateway !== 'maya' || !tx.gatewayPaymentId) {
      return res.json({
        status: settled ? 'succeeded' : 'pending',
        totalPaid: tx.totalPaid,
        balance: tx.balance,
        gateway: tx.gateway ?? 'paymongo',
      });
    }

    // The webhook is the source of truth, but if it never arrived this poll
    // repairs it: a Maya-confirmed payment is credited here too, through the
    // same idempotent ledger call.
    const { retrievePayment, retrievePaymentStatus } = await import('../services/maya.service.js');
    const { applyPaymentToTransaction } = await import('../services/payments.ledger.js');

    let status = 'PENDING';
    let amount = 0;
    try {
      const verified = await retrievePayment(tx.gatewayPaymentId);
      status = verified.status;
      amount = verified.amount;
    } catch {
      status = (await retrievePaymentStatus(tx.gatewayPaymentId)).status;
    }

    if (status === 'SUCCESS' && amount > 0) {
      const result = await applyPaymentToTransaction({
        transactionId: tx.id,
        amount,
        gateway: 'maya',
        gatewayRef: tx.gatewayPaymentId,
        method: 'maya',
      });
      return res.json({ status: 'succeeded', totalPaid: result.totalPaid, balance: result.balance, gateway: 'maya' });
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
```

- [ ] **Step 5: Register the route**

In `backend/src/routes/payments.routes.ts`, add **above** the `router.get('/:id', ...)` line:

```ts
router.get('/transaction/:transactionId/status', authMiddleware, paymentsController.getPaymentStatus);
```

- [ ] **Step 6: Run to verify it passes**

```bash
npx vitest run tests/maya.test.ts tests/payments.test.ts tests/paymongo-simulate.test.ts
```

Expected: all passing.

- [ ] **Step 7: Typecheck + commit**

```bash
npx tsc --noEmit
git add backend/src/controllers/payments.controller.ts backend/src/routes/payments.routes.ts backend/tests/maya.test.ts
git commit -m "feat(payments): gateway-aware charge creation + payment status polling"
```

---

## Task 6: Settings, health probe, and legal copy

**Files:**
- Modify: `backend/src/controllers/settings.controller.ts` (line ~275 fan-out)
- Modify: `backend/prisma/seed.ts` (done in T1 — verify present)
- Modify: `frontend/src/components/settings/IntegrationsTab.jsx`
- Modify: `frontend/src/components/TermsContent.jsx:32,110`
- Modify: `frontend/src/pages/PrivacyPolicyView.jsx:29`
- Test: `backend/tests/maya.test.ts` (append one health assertion)

**Interfaces:**
- Consumes: `checkMayaHealth` (T2)
- Produces: `GET /settings/integrations-status` gains a `maya` key

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/maya.test.ts`:

```ts
describe('GET /api/settings/integrations-status', () => {
  it('exposes a maya row', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const res = await request(app)
      .get('/api/settings/integrations-status')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('maya');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/maya.test.ts
```

Expected: FAIL — no `maya` key.

- [ ] **Step 3: Add Maya to the health fan-out**

In `backend/src/controllers/settings.controller.ts`, add `mayaService.checkMayaHealth()` to the existing `Promise.all` (currently `[ai, semaphore, paymongo, brevo]`) and add `maya,` to the response body alongside `paymongo, brevo,`. Add the import.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run tests/maya.test.ts tests/settings.test.ts
```

Expected: all passing.

- [ ] **Step 5: Add the Integrations UI**

In `frontend/src/components/settings/IntegrationsTab.jsx`:

1. Add to `INTEGRATIONS`:
```jsx
  { key: 'maya', name: 'Maya QR / QRPh', desc: 'Maya wallet + QRPh downpayments via scan or redirect.', icon: QrCode, iconClass: 'bg-sky-50 text-sky-600' },
```
(add `QrCode` to the `lucide-react` import)

2. Above the `{INTEGRATIONS.map(...)}` list, render an admin-only selector. Reuse the existing `SettingsCard` styling; a `<select>` that PUTs `payment_gateway` through `settingsService.updateRules`:

```jsx
{role === 'Admin' && (
  <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-gray-100">
    <div className="min-w-0">
      <p className="font-bold text-sm text-gray-900">Payment Gateway</p>
      <p className="text-xs text-gray-500 mt-0.5">Used for new booking downpayments. Takes effect immediately.</p>
    </div>
    <select
      aria-label="Payment Gateway"
      value={gateway}
      onChange={handleGatewayChange}
      disabled={gatewaySaving}
      className="shrink-0 text-xs font-bold px-3 py-2 rounded-full bg-gray-100 text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40"
    >
      <option value="paymongo">PayMongo</option>
      <option value="maya">Maya QRPh</option>
    </select>
  </div>
)}
```

Wire `handleGatewayChange` to `settingsService.updateRules({ payment_gateway: value })`, update local state on success, and toast on failure. Initialize `gateway` from the cached integrations payload if present, else `'paymongo'`.

- [ ] **Step 6: Make the legal copy processor-agnostic**

`TermsContent.jsx:32` — replace `Payments are processed through PayMongo (GCash and credit card) or in-store.` with `Payments are processed through our payment partners (Maya or PayMongo) or in-store.`

`TermsContent.jsx:110` and `PrivacyPolicyView.jsx:29` — replace `We share data with our payment processor (PayMongo) only to the extent needed to complete payments` with `We share data with our payment processors (Maya or PayMongo) only to the extent needed to complete payments`.

- [ ] **Step 7: Build + commit**

```bash
cd frontend && npm run build
git add backend/src/controllers/settings.controller.ts frontend/src/components/settings/IntegrationsTab.jsx frontend/src/components/TermsContent.jsx frontend/src/pages/PrivacyPolicyView.jsx backend/tests/maya.test.ts
git commit -m "feat(payments): Maya integration status, gateway selector, processor-agnostic copy"
```

---

## Task 7: The customer checkout flow

**Files:**
- Modify: `frontend/src/components/CustomerRentalFlow.jsx:344-412`
- Create: `frontend/src/pages/PaymentReturnView.jsx`
- Modify: `frontend/src/App.jsx` (mount `/payment-return`, near line 833)
- Modify: `frontend/src/services/payments.js`, `frontend/src/hooks/usePayments.js`
- Modify: `frontend/src/utils/demoInterceptor.js:615-616`
- Test: `backend/tests/maya.test.ts` unaffected; frontend has no test runner — `npm run build` is the gate

**Interfaces:**
- Consumes: `POST /payments/create-intent` (`gateway`, `redirectUrl`, `expiresAt`, `simulated`), `GET /payments/transaction/:id/status`
- Produces: `usePayments().getStatus(transactionId)`; `paymentsService.getStatus`

- [ ] **Step 1: Add the status service + hook**

`frontend/src/services/payments.js`:

```js
  getStatus: (transactionId) => api.get(`/payments/transaction/${transactionId}/status`),
```

`frontend/src/hooks/usePayments.js`:

```js
  const getStatus = useCallback((transactionId) => paymentsService.getStatus(transactionId), []);
  return { createIntent, get, getStatus };
```

- [ ] **Step 2: Demo-mode route**

In `frontend/src/utils/demoInterceptor.js`, add **before** the generic `/^\/payments\/(.+)$/` matcher at line 616:

```js
    if (P(/^\/payments\/transaction\/(.+)\/status$/)) return { value: { status: 'succeeded', totalPaid: 2000, balance: 3000, gateway: 'maya' } };
```

- [ ] **Step 3: Branch step 2 in `CustomerRentalFlow.jsx`**

Replace the block at lines 377-400 (the `if (intent.simulated)` through the `openDropIn` catch) so it dispatches on `intent.gateway`:

```jsx
        // No gateway configured: simulate a success so the booking can complete
        // end-to-end offline (existing dev path).
        if (intent.simulated) {
          toastInfo('Payment gateway not configured — simulating successful payment.');
          setPaymentSuccess(true);
          setConfirmedTx(created);
          setTimeout(() => { setPaymentSuccess(false); setStep(3); }, 1500);
          return;
        }

        // Maya: the customer leaves for Maya's hosted page and comes back to
        // /payment-return. We CANNOT claim success here — the webhook (or the
        // return page's poll) is what confirms it.
        if (intent.gateway === 'maya') {
          setIsProcessingPayment(false);
          window.location.assign(intent.redirectUrl);
          return;
        }

        // PayMongo: hosted drop-in, synchronous outcome.
        try {
          await openDropIn(intent.clientKey, {
            amount: Number(downpaymentAmount) * 100,
            currency: 'PHP',
            description: `Rental downpayment for ${selectedItem?.name || 'item'}`,
          });
        } catch (payErr) {
          setConfirmError(payErr?.message || 'Payment was cancelled or failed.');
          if (onCancelBooking) await onCancelBooking(created);
          return;
        }
        setPaymentSuccess(true);
        setConfirmedTx(created);
        setTimeout(() => { setPaymentSuccess(false); setStep(3); }, 1500);
```

Note: the existing code reads `intent.paymentIntentId` nowhere for navigation, so nothing else changes.

- [ ] **Step 4: Create `PaymentReturnView.jsx`**

New page at `frontend/src/pages/PaymentReturnView.jsx`. Polls `getStatus` every 3s for up to 10 minutes (200 attempts), then stops. Match the app's visual language: burgundy `#bf4a53`, `rounded-3xl`, `font-bold`.

States:
- `pending` → spinner (`Loader2` + `animate-spin`, as used in `CustomerRentalFlow.jsx:835`) + "Confirming your payment…" + "This usually takes a few seconds."
- `succeeded` → `CheckCircle2` in emerald + "Payment confirmed" + a link to `/transactions/<txId>`.
- `failed` / `expired` → the same warning style used at `CustomerRentalFlow.jsx:924` (amber, `border-amber-200`) + "Payment not completed" + two buttons: **Try again** (`navigate('/')` — reopening the catalog and rebooking is the honest path, since a new charge needs a new downpayment amount) and **Cancel**.

Read `tx` from `new URLSearchParams(window.location.search).get('tx')`. If absent, render a plain error card linking to `/`. Clear the poll timer in the effect cleanup so an unmount mid-poll can't setState.

Use `useToast` for the failure path; on failure also `toastError('Payment not completed')`.

- [ ] **Step 5: Mount the route**

In `frontend/src/App.jsx`, beside the `/verify-email` early return (~line 833), add:

```jsx
  // Landing page after the customer completes (or abandons) a Maya payment.
  if (location.pathname === '/payment-return') {
    return <PaymentReturnView />;
  }
```

Add a lazy import alongside the existing lazy declarations (line ~60):
```jsx
const PaymentReturnView = lazy(() => import('./pages/PaymentReturnView'));
```

Wrap in the same `<Suspense>` the other public routes use.

- [ ] **Step 6: Build + commit**

```bash
cd frontend && npm run build
git add frontend/src/components/CustomerRentalFlow.jsx frontend/src/pages/PaymentReturnView.jsx frontend/src/App.jsx frontend/src/services/payments.js frontend/src/hooks/usePayments.js frontend/src/utils/demoInterceptor.js
git commit -m "feat(payments): Maya redirect checkout and payment return page"
```

---

## Task 8: Full verification and docs

- [ ] **Step 1: Backend typecheck + full suite**

```bash
cd backend && npx tsc --noEmit
npx vitest run
```

Expected: zero type errors, every test passing (baseline was 448/448 — any new failure is this branch's).

- [ ] **Step 2: Confirm no schema drift**

```bash
cd backend && npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: exit 0.

- [ ] **Step 3: Frontend build**

```bash
cd frontend && npm run build
```

Expected: success.

- [ ] **Step 4: Manual smoke test both gateways**

With the backend running and Maya keys **unset** (simulated mode), walk a booking end-to-end as a customer — it must complete without a redirect.

Then set `payment_gateway = 'maya'` via Settings → Integrations, or in the DB, and walk it again. Expect: redirect to Maya (or an immediate simulated success if `MAYA_PUBLIC_KEY` is empty), and the return page resolving.

- [ ] **Step 5: Record the Maya IPs and env placeholders**

Add to `backend/.env` (placeholders only — do not invent values):

```
MAYA_PUBLIC_KEY=
MAYA_SECRET_KEY=
MAYA_ENV=sandbox
MAYA_SIMULATE=false
MAYA_WEBHOOK_ALLOWED_IPS=
```

`.env` is not committed — confirm it is gitignored before assuming.

- [ ] **Step 6: Update `AGENTS.md`**

Add to **Important Details**: the Maya gateway, the `payment_gateway` rule, the webhook trust model (IP allowlist + secret-key re-check, no HMAC), the always-200 rule, the polling endpoint, and the `gatewayRef` rename. Add Maya to **Relevant Files**. Update the **Completed** section.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md
git commit -m "docs: record the Maya QRPh gateway"
```

- [ ] **Step 8: Hand back**

Report: branch name, commit list, test counts before/after, and the manual smoke results for both gateways. Note explicitly that the live flip (`payment_gateway = 'maya'`) is **not** done by this branch — it stays `paymongo` until Maya merchant onboarding completes.

---

## Rollout Checklist (operator, not code)

1. Deploy this branch — `payment_gateway` defaults to `paymongo`, so nothing changes for customers.
2. Maya merchant onboarding + sandbox credentials.
3. Register `https://<host>/api/webhooks/maya` for `PAYMENT_SUCCESS` / `PAYMENT_FAILED` / `PAYMENT_EXPIRED` / `PAYMENT_CANCELLED` in Maya Manager.
4. Set `MAYA_WEBHOOK_ALLOWED_IPS` from Maya's published list.
5. Sandbox smoke test: one real ₱200 booking.
6. Flip `payment_gateway = 'maya'` in production.
7. Watch Maya's webhook delivery log against `Payment` rows for 24h.

**Rollback:** set `payment_gateway = 'paymongo'`. The ledger is gateway-agnostic, so in-flight Maya payments still land correctly.