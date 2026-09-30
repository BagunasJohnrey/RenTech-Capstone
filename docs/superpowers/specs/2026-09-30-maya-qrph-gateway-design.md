# PRD: Maya QRPh Payment Gateway

**Project:** RENTECH — Mylene's Boutique Rental Management System
**Date:** 2026-09-30
**Status:** Draft — awaiting spec review
**Supersedes:** PayMongo as the default downpayment gateway (PayMongo is retained as a selectable fallback)

---

## 1. Problem Statement

RENTECH collects a downpayment at booking time. It currently uses **PayMongo** with the
hosted Drop-In SDK (`frontend/src/hooks/usePaymongo.js`), which is good at cards + GCash but
is not what our customers overwhelmingly use for wallet-to-wallet (Maya) transfers.

We are switching the live gateway to **Maya QRPh** via the Pay with Maya API. Maya QRPh is
native to the Philippines (BancNet/QRIS P2M standard), has no per-transaction MDR as punishing
as card rails for a ₱200–₱5,000 downpayment, and the customer pays with the app they already
have.

**This is not a config swap.** Maya's QRPh flow is asynchronous and redirect-based; PayMongo's
Drop-In is synchronous and in-page. That difference ripples into the schema, the webhook
security model, the confirmation UX, and the retry semantics. This document specifies the
replacement.

### 1.1 Goals

| # | Goal | Success measure |
|---|------|-----------------|
| G1 | Customers pay downpayments through Maya QRPh | Maya shows the payment in its dashboard; `Payment.gateway = 'maya'` rows appear |
| G2 | A paid booking is always confirmed, even if the webhook is lost | No booking left in "paying" state longer than 10 minutes without resolution |
| G3 | PayMongo remains usable as a fallback | Flipping one admin setting switches gateways with no redeploy |
| G4 | Local dev still works with no credentials | Booking flow completes end-to-end with simulated mode |
| G5 | The payment boundary is gateway-agnostic | Adding a third gateway touches one service file, not the controller or UI |

### 1.2 Non-goals

- **Maya Checkout / linked wallet** — hosted Maya checkout page and Link-Wallet flows are out
  of scope. QRPh + the Maya-hosted redirect page only.
- **Card payments** — PayMongo remains the only card path. If `payment_gateway = paymongo`, the
  Drop-In (cards + GCash) is used exactly as today.
- **Multi-partial payments per booking** — still one downpayment charge at booking, balance at
  pickup. Unchanged.
- **Reconciliation / settlement reporting** — Maya settlement reports are a finance concern,
  not a product feature in this pass.

---

## 2. How Maya QRPh Works (the constraints that drive the design)

From the [Pay with Maya](https://developers.maya.ph/docs/pay-with-maya) docs:

1. Merchant calls `POST /payments/v1/qr/payments` (**public key**, Basic auth) with the amount
   in **centavos**, a `requestReferenceNumber`, and `redirectUrl` targets.
2. Response returns `paymentId`, `redirectUrl` (Maya-hosted page), and `qrCodeBody`.
3. **Dynamic QRPh codes are one-time use and valid for 1 hour.** After that the payment must be
   recreated.
4. Customer scans / is redirected, pays.
5. Maya notifies **our server** by webhook (`PAYMENT_SUCCESS`, `PAYMENT_FAILED`,
   `PAYMENT_EXPIRED`, `PAYMENT_CANCELLED`). We must return `200` **within 5 seconds** or Maya
   retries (max 4 retries).
6. **Maya webhooks carry no HMAC signature.** Maya's documented mitigations are (a) whitelisting
   Maya's webhook IPs and (b) re-querying the payment with our secret key.
7. If the webhook doesn't arrive, status can be polled: `GET /payments/v1/payments/{id}/status`
   (public key) or `GET /payments/v1/payments/{id}` (secret key).

Four of these are the reason this isn't a swap:

| Constraint | Consequence |
|---|---|
| Webhook is the only push | Booking stays **pending** until the server hears back. The client can't decide success itself. |
| No HMAC | We must authenticate webhooks a different way (IP + secret-key re-check). |
| 1-hour, one-time QR | The confirm UI needs an expiry countdown and a "create a new QR" path. |
| Customer leaves our site | We need a **return page** to land them on. |

---

## 3. Architecture

### 3.1 The gateway boundary

Both gateways return one normalized shape, so `payments.controller.ts` and the frontend never
branch on provider:

```ts
type GatewayCharge = {
  gateway: 'paymongo' | 'maya';
  id: string;              // payment intent id / Maya paymentId
  status: string;
  amount: number;          // pesos (clients never see centavos)
  currency: 'PHP';
  simulated: boolean;
  clientKey?: string;      // paymongo — for the Drop-In
  redirectUrl?: string;    // maya — the Maya-hosted payment page
  qrCodeBody?: string;     // maya — for embedded display (future)
  expiresAt?: string;      // maya ISO — created + 1h
};
```

```
                    ┌─────────────────────────────┐
  BusinessRule      │  payment_gateway            │
  payment_gateway   │  'paymongo' | 'maya'        │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  payments.controller.ts     │
                    │  (gateway-blind)             │
                    └───┬─────────────────────┬───┘
                        │                     │
        ┌───────────────▼──────┐   ┌──────────▼───────────────┐
        │ paymongo.service.ts  │   │ maya.service.ts          │
        │ intent + clientKey   │   │ QRPh + redirectUrl       │
        └───────────────┬──────┘   └──────────┬───────────────┘
                        │                     │
        ┌───────────────▼─────────────────────▼───┐
        │  payments.ledger.ts                     │
        │  applyPaymentToTransaction()            │
        │  (idempotent crediting, shared)         │
        └───────────────┬─────────────────────────┘
                        │
        ┌───────────────▼──────────────┐
        │ /api/webhooks/paymongo      │  HMAC verify
        │ /api/webhooks/maya          │  IP allowlist + secret-key re-check
        │ GET /api/payments/:tx/status│  polling self-heal
        └──────────────────────────────┘
```

### 3.2 Gateway selection

A `BusinessRule` row `payment_gateway`, default `'paymongo'`. Read via the existing
`getBusinessRules()` (`backend/src/services/settings.service.ts:4`), edited via the existing
admin-only `PUT /settings/rules` — which is already behind `requireMfaAdmin`.

Switching gateways is a data change, not a deploy. It takes effect on the next booking.

**Rollback:** set the rule back to `paymongo`. Existing Maya payments still resolve through
their webhook and the ledger, which is gateway-agnostic.

### 3.3 `maya.service.ts`

Mirrors `paymongo.service.ts` conventions exactly: `AbortSignal.timeout`, no upstream error
bodies forwarded (`L7`), Basic auth from env keys.

| Function | Endpoint | Key |
|---|---|---|
| `createQrPayment(amount, description, opts)` | `POST /payments/v1/qr/payments` | public |
| `retrievePayment(paymentId)` | `GET /payments/v1/payments/{id}` | secret |
| `retrievePaymentStatus(paymentId)` | `GET /payments/v1/payments/{id}/status` | public |
| `cancelPayment(paymentId)` | `POST /payments/v1/payments/{id}/cancel` | secret |
| `checkMayaHealth()` | probe (no payment created) | secret |

- **Amounts in centavos** (integers) at the boundary; the service converts and the client only
  ever sees pesos.
- `createQrPayment` sets `redirectUrl: { success, failure, cancel }` pointing at our return
  route with the transaction id attached, so the webhook isn't the only way back.
- `checkMayaHealth()` returns the same `{configured, reachable, latencyMs, detail}` shape as
  `checkPaymongoHealth()`; a 401 reports "Invalid secret key".
- Base URL from `MAYA_ENV`: sandbox `pg-sandbox.paymaya.com`, production `pg.paymaya.com`.

### 3.4 Confirmation: webhook primary, polling self-heal

**`POST /api/webhooks/maya`** — unauthenticated (Maya calls it), no HMAC:

1. If `MAYA_WEBHOOK_ALLOWED_IPS` is set and `req.ip` isn't in it → `403`. When unset, the
   allowlist is skipped and the secret-key re-check alone carries the trust.
2. Resolve the transaction by `gatewayPaymentId === body.id`, falling back to
   `metadata.transactionId`. (The ref is written at charge-creation time, so this is reliable.)
3. **Re-verify with the secret key**: `retrievePayment(id)` must return `SUCCESS` and an amount
   matching the payload. The payload's own numbers are never trusted.
4. On `SUCCESS` → `applyPaymentToTransaction()`. On any other status → no-op `200`.
5. **Always return `200` within Maya's 5s window.** If the re-check itself fails (timeout,
   upstream down), respond `{ received: true, verified: false }` and credit nothing. The
   polling endpoint below repairs it. A retry storm is strictly worse than a delayed booking.

**`POST /api/webhooks/paymongo`** keeps its existing HMAC verification and calls the same
shared ledger function.

**`GET /api/payments/:transactionId/status`** — the safety net. Owner-or-staff scoped, reusing
the ownership guard from `getPayment` (`payments.controller.ts:79-89`).

Returns `{ status, totalPaid, balance, gateway }` where status ∈
`pending | succeeded | failed | expired`. When the local state is unpaid and the gateway is
Maya, it calls `retrievePaymentStatus` and — if Maya says `SUCCESS` — runs
`applyPaymentToTransaction` itself. **This is what guarantees G2**: a dropped or blocked webhook
heals from the customer's own browser within one poll interval.

### 3.5 The shared ledger

The crediting logic currently inlined in `webhooks.controller.ts:73-114` moves verbatim into
`backend/src/services/payments.ledger.ts`:

```ts
applyPaymentToTransaction({
  transactionId, amount, gateway, gatewayRef,
  method: 'gcash' | 'card' | 'maya',
}): Promise<{ duplicate: boolean }>
```

- `Payment.create` guarded by the `gatewayRef` unique constraint
- `P2002` → `{ received: true, duplicate: true }` (concurrent duplicate deliveries)
- Recompute `totalPaid` / `balance` from `rentalFee + latePenalty + damageFee`
- `createAuditLog` + `clearDataCache()`

Two existing derivations move into the signature rather than being re-guessed per gateway:
`Payment.method` (today inferred from the PayMongo `source === 'gcash'` check at
`webhooks.controller.ts:52`, now `'maya'` for QRPh) and `Payment.type`
(`amount >= tx.rentalFee ? 'full_payment' : 'downpayment'`, `webhooks.controller.ts:78`).
Both callers derive them the same way.

No behavior change for PayMongo. Both webhooks and the polling endpoint call this function, so
idempotency, balance math, and payment classification are defined once.

---

## 4. Data Model

```prisma
model Payment {
  // ...
  gateway    String  @default("paymongo")
  gatewayRef String? @unique @map("gateway_ref")   // replaces paymongoPiId
  // ...
}

model Transaction {
  // ...
  gateway           String?  @map("gateway")
  gatewayPaymentId  String?  @map("gateway_payment_id")  // replaces paymentIntentId
  // ...
}
```

### 4.1 Migration

`paymongoPiId` is provider-named but now holds refs from two providers, so it's renamed rather
than overloaded. Steps:

1. Add `gateway`, `gateway_ref` to `payments`; add `gateway`, `gateway_payment_id` to
   `transactions`.
2. Backfill `gateway = 'paymongo'` and `gateway_ref = paymongo_pi_id` for existing rows.
3. Drop `paymongo_pi_id`.
4. `npx prisma generate` — **backend must be stopped first** (EPERM on the engine DLL).
5. Record the change in `migrations/` so it isn't another undocumented `db push`.

> **Operational note:** DDL goes to the direct host via `DIRECT_URL`, never the transaction-mode
> pooler (`db push` hangs on the advisory lock there). Read-only drift verification with
> `migrate diff --from-schema-datasource … --exit-code` is the safe check. **Verify the push
> path before scheduling this work:** the Supabase project hostname `db.vlidakdroeqpoemzolus`
> resolves again as of 2026-09-30, but direct-host `:5432` for this project has previously been
> IPv6-only and unreachable from this machine. Run the no-drift check first; if direct DDL is
> still unavailable, the alternative is a hand-written `ALTER TABLE` executed through
> `prisma db execute` on a reachable connection, plus `schema.prisma` updated to match.

---

## 5. Frontend

### 5.1 Booking flow

`CustomerRentalFlow.jsx` step 2 (`handleNextInner`, lines 344-412) branches on
`intent.gateway`:

- **`paymongo`** — unchanged. `openDropIn(intent.clientKey, …)`, then straight to the receipt.
- **`maya`** — no Drop-In. The controller returns `redirectUrl`; the client navigates there and
  the booking step ends **without** claiming success.
- **`simulated`** — unchanged (`CustomerRentalFlow.jsx:380`).

The "Payment Confirmed!" overlay (`line 840`) moves from being an assumption to being a fact:
for Maya it renders after the return page confirms.

### 5.2 Return page

New route `pages/PaymentReturnView.jsx`, mounted in `App.jsx` next to `/verify-email` — a
full-page public-route render, since the customer may land here with a fresh tab.

On mount it polls `GET /api/payments/:txId/status` every 3s for up to 10 minutes:

| Polled status | Screen |
|---|---|
| `pending` | "Confirming your payment…" + spinner. Not an error. |
| `succeeded` | Success panel → receipt, booking confirmed |
| `failed` / `expired` | "Payment not completed" + *Try again* (new QR) / *Cancel booking* |

The 1-hour QR expiry is shown as a countdown on the payment step. On expiry the *Try again*
path creates a **new** Maya charge — the old `paymentId` is superseded in
`Transaction.gatewayPaymentId`, and its late webhook is absorbed by the
`applyPaymentToTransaction` duplicate/`transaction-closed` guards.

### 5.3 Settings

`IntegrationsTab.jsx` gains a row for Maya (status comes free from the existing fan-out at
`settings.controller.ts:275`) and an admin-only **Payment Gateway** selector above the list —
`PayMongo` or `Maya`. Changing it PUTs `payment_gateway` through the existing rules endpoint
(MFA-gated).

### 5.4 Copy and legal text

`TermsContent.jsx:32` and `PrivacyPolicyView.jsx:29` currently name PayMongo as *the* payment
processor. Both become processor-agnostic ("Maya or PayMongo") so the text stays true under
either setting. This is a data-privacy disclosure, so it ships with the feature, not after.

### 5.5 Demo mode

`demoInterceptor.js` answers the new `/payments/:txId/status` route with `succeeded` so the
flow demos without a gateway. No `qrCodeBody` rendering is demoed.

---

## 6. Environment Variables

| Variable | Purpose |
|---|---|
| `MAYA_PUBLIC_KEY` | QR creation + status polling |
| `MAYA_SECRET_KEY` | Retrieve/cancel, webhook re-check, health |
| `MAYA_ENV` | `sandbox` \| `production` → base URL |
| `MAYA_SIMULATE` | Production escape hatch, mirrors `PAYMONGO_SIMULATE` |
| `MAYA_WEBHOOK_ALLOWED_IPS` | Comma-separated. Empty ⇒ allowlist skipped, re-check carries trust. |
| `FRONTEND_URL` | Already exists — used to build `redirectUrl` targets |

All optional. No keys ⇒ simulated mode (except in production without `MAYA_SIMULATE`, which is a
hard `503` — a silent simulation in prod would confirm payments that never happened).

---

## 7. Testing

New `backend/tests/maya.test.ts`:

- QR creation returns `paymentId` / `redirectUrl`, converts pesos → centavos
- **Simulated mode** with no keys (mirrors `paymongo-simulate.test.ts`)
- **Webhook re-check rejects a forged payload** — attacker POSTs `PAYMENT_SUCCESS` for an
  unpaid booking; the secret-key call returns non-`SUCCESS`, nothing is credited
- **Webhook re-check rejects an amount mismatch** (underpayment can't mark a booking paid)
- Duplicate webhook → `{ duplicate: true }`, `totalPaid` unchanged
- IP allowlist rejects a non-allowlisted source when configured
- Polling endpoint credits on `SUCCESS` and returns `succeeded`
- Polling endpoint is 403 for another customer's transaction
- Health probe reports `401` as "Invalid key"

Plus:

- Existing `payments.test.ts` and `paymongo-simulate.test.ts` must stay green unchanged —
  **that is the regression proof that PayMongo is untouched.**
- Frontend `vite build` passes; a manual pass over: Maya booking → redirect → return → receipt,
  and the same with `payment_gateway = paymongo`.

Verification bar: backend `tsc` clean, full vitest suite green, frontend build green.

---

## 8. Rollout

1. Ship behind the rule, defaulting to `paymongo` — deploy is a no-op for customers.
2. Configure Maya sandbox keys; complete the merchant onboarding Maya requires.
3. Register the production webhook URL in Maya Manager; add the webhook IPs.
4. Smoke-test one real ₱200 booking in sandbox.
5. Flip `payment_gateway = 'maya'` in production.
6. Watch the Maya webhook delivery log against `Payment` rows for 24h.

**Rollback is one setting.** Any booking that gets stuck flips back immediately; the ledger is
gateway-agnostic, so in-flight Maya payments still land correctly.

### 8.1 Operational risks

| Risk | Mitigation |
|---|---|
| Webhook IP list changes at Maya | `MAYA_WEBHOOK_ALLOWED_IPS` is config, not code; the secret-key re-check means a stale list degrades to *rejected* rather than *compromised*. Monitor. |
| Webhook delivery blocked (firewall, proxy) | Polling endpoint self-heals; 10-minute ceiling. |
| 1-hour QR expiry surprises a customer | Countdown on the payment step + one-tap *Try again*. |
| Maya merchant approval is a business process | Starts in step 2; the code ships and waits. |
| `paymongo.service.ts` name is now a misnomer | Left as-is — it's the PayMongo service, correct by name. |

---

## 9. Open Questions

1. **Embedded QR vs redirect-only.** This spec builds the redirect. `qrCodeBody` is captured in
   the normalized shape so an in-page QR is a frontend-only addition later — but it needs a
   client QR renderer (new dependency or hand-rolled). Deliberately out of scope now.
2. **Staff recording a manual/walk-in payment.** Unaffected — those paths don't call a gateway —
   but worth confirming there's no assumption elsewhere that every `Payment` has a `gatewayRef`.
3. **Sandbox merchant onboarding timeline.** Maya issues production credentials after Merchant
   Services reviews the sandbox integration, so steps 2-4 are on their clock, not ours.