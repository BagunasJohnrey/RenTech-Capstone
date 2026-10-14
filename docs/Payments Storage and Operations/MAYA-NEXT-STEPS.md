# Maya QRPh — What To Do Next

Branch: `feat/maya-qrph-gateway` (local only, never pushed, **unmerged on purpose**)
Spec: `docs/superpowers/specs/2026-09-30-maya-qrph-gateway-design.md`
Plan: `docs/superpowers/plans/2026-09-30-maya-qrph-gateway.md`

---

## 1. Read this first: one live footgun

**`payment_gateway` is currently set to `'maya'` in the shared database.**

It was set so the Maya payment-method UI could be previewed locally. That row lives in
the same Supabase database production uses.

| Now | After merging the branch |
|---|---|
| ✅ Harmless — production runs the pre-Maya code, which never reads that rule | ❌ **Real production bookings route to Maya, which hard-fails `503` with no keys** |

**Set it back to `paymongo` before merging.**

- In-app: Settings → Integrations → Payment Gateway → **PayMongo**
- Or ask me and it's one command.

Verify:

```powershell
cd backend
npx tsx -e "import 'dotenv/config'; import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); p.businessRule.findMany({where:{key:'payment_gateway'}}).then(r=>{console.log(r.map(x=>x.value)); return p.\$disconnect()})"
```

---

## 2. Current state (verified)

| | |
|---|---|
| Production | Healthy. `/api/health` ok, transactions + condition photos verified 200 |
| `development` / `main` | Cancel-flow fix live (`39b1d0d`). Maya **not** merged |
| Maya branch | 19 commits, **508/508** tests, `tsc` clean, `vite build` passes |
| Security review | 2 rounds, all Criticals + Importants fixed (see §7) |
| Maya credentials | ⛔ Not applied for yet — the only calendar-bound blocker |

---

## 3. Your action: apply to Maya (start today)

This gates everything. Production keys are only issued **after** Merchant Services reviews
your sandbox integration, so the sooner you start, the sooner it lands.

1. Go to **https://pbm.paymaya.com** → create a Maya Business Manager account (email is enough)
2. Activate the **online payment / QR Ph** product
3. **Do not** accept the static counter QR, Invoice Payments, or Payment Links — none of those
   issue API keys

### Ask for these two things, in writing, in the activation ticket

> **Product:** Pay with Maya QRPh API — `POST /payments/v1/qr/payments` and
> `GET /payments/v1/payments/{id}`, plus webhook registration.
> *Not* Maya Checkout, *not* the static counter QR.

> **Question:** "Does this activation include the **Pay with Maya QRPh API**
> (`/payments/v1/qr/payments`), or only **Maya Checkout**?"

Maya lists these as separate products. If the answer is *Checkout only*, stop and tell me
before committing — the gateway boundary is provider-agnostic so adapting is a small change,
but it's a different endpoint.

### ⚠️ Verify the amount on your first live charge

The app was briefly shipping amounts **100× too large** (a `centavos` vs `pesos` bug, since
fixed). Before any real booking:

1. Make one **₱200** sandbox charge
2. **Read the amount on the QR / Maya's page — it must say ₱200, not ₱20,000**

If it shows 100×, stop and report it. The API takes **pesos** (a float, `minimum 0.01`).

---

## 4. Test end-to-end now, with no credentials

A mock Maya ships with the branch. It exercises the real code path — redirect, return page,
polling self-heal, and the forged-webhook refusal.

```powershell
# terminal 1 — from the repo root
npm run dev

# terminal 2 — the mock gateway
cd backend
npx tsx scripts/mock-maya.mts
```

Put this in `backend/.env` (leave the keys blank otherwise) and restart the backend:

```
MAYA_BASE_URL=http://127.0.0.1:4599
MAYA_PUBLIC_KEY=pk_mock
MAYA_SECRET_KEY=sk_mock
```

Set `payment_gateway = maya` (Settings → Integrations), then walk it:

| Scenario | Command | Expected |
|---|---|---|
| Happy path | `Invoke-RestMethod -Method POST http://127.0.0.1:4599/__mock/pay/<paymentId>` | Return page flips to confirmed |
| Expired QR | `.../__mock/expire/<paymentId>` | "not completed" + **Pay again** |
| Underpayment | `.../__mock/fail/<paymentId>` | Failure state, nothing credited |
| **Forged webhook** | see below | **Nothing credited** |

```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:3001/api/webhooks/maya `
  -ContentType 'application/json' `
  -Body '{"id":"pay-maya-1","paymentStatus":"SUCCESS","metadata":{"transactionId":"someone-elses-booking"}}'
```

Expect `{"received":true,"verified":false}`. That payload tries to mark an arbitrary booking
paid using a payment bound to another booking — it was a real Critical in review and is now
refused structurally. **Worth seeing refused once in a browser.**

Automated equivalent: `npx tsx scripts/verify-mock-e2e.mts`

---

## 5. Decide: merge the branch?

**Recommendation: yes**, once §1 is done.

- Inert by default (`payment_gateway` → `paymongo`)
- 508 tests, two review rounds, all findings fixed
- Gains the Maya payment-method UI and the admin gateway selector

```powershell
git checkout development
git merge feat/maya-qrph-gateway     # or a PR into development
```

⚠️ `development` auto-merges into `main`, so this reaches production.

**After merging, verify production the same way it was verified before:**

```powershell
Invoke-RestMethod https://rentech-myleneboutique.vercel.app/api/health
# then in the app: load a transaction detail, confirm a condition photo renders
```

**Holding is also defensible** — the branch is safe parked and Maya can't go live without
keys anyway. Your call.

---

## 6. When keys arrive

1. `backend/.env`:
   ```
   MAYA_PUBLIC_KEY=pk-...
   MAYA_SECRET_KEY=sk-...
   MAYA_ENV=sandbox
   ```
2. Restart the backend (`.env` changes need a restart — the watcher only reloads on code changes)
3. Confirm `/api/settings/integrations-status` shows Maya **Connected** (Settings → Integrations → Refresh)
4. Book one real sandbox rental end-to-end
5. Register the webhook: `POST /payments/v1/webhooks` with your **secret** key, pointing at
   `https://<your-host>/api/webhooks/maya`. Subscribe to **`PAYMENT_SUCCESS`**,
   `PAYMENT_FAILED`, `PAYMENT_EXPIRED`, `PAYMENT_CANCELLED` — *not* the deprecated `CHECKOUT_*`
6. Add Maya's published webhook IPs to `MAYA_WEBHOOK_ALLOWED_IPS`
7. **Do the ₱200 amount check** (§3) before trusting anything
8. Go live: production keys → flip Settings → Integrations → Payment Gateway → Maya

**Rollback is that same selector.** The ledger is gateway-agnostic, so in-flight Maya payments
still settle correctly.

The webhook can't reach `localhost` — but the polling self-heal confirms payments without any
public URL, so customer-facing testing works regardless. Use a tunnel only if you want to
exercise the real webhook path locally.

---

## 7. Security model, in one paragraph

Maya webhooks are **unsigned**, so nothing in the payload is trusted. The booking is resolved
**only** by the `Transaction.gatewayPaymentId` we stored at charge time — the payload's
`metadata.transactionId` is never read — then a **mandatory secret-key re-check** with Maya must
confirm `SUCCESS`, and only Maya's amount is credited. Every path answers `200` within Maya's
5-second window, and the route has its own per-IP limiter because `/api/webhooks` is mounted
before the global one.

Already found and fixed: webhook binding forgery (Critical), a dead `err.status` vs
`statusCode` guard that broke the always-200 contract (Critical), a non-atomic ledger, a poller
that reported success it hadn't caused, a `X-Forwarded-For` limiter bypass, and a PayMongo IDOR
I introduced. Details in `AGENTS.md`.

---

## 8. Deferred / known debt

None of it blocks the launch, but it should be tracked:

- **No migration file.** The `paymongoPiId → gatewayRef` rename exists only in the live DB;
  `migrations/` still holds the August baseline. **I can write this on request.**
- **Ledger atomicity is unpinned by tests** — `tests/setup.ts` mocks `$transaction` with no
  rollback, so moving a write outside the transaction wouldn't fail a test. Worth verifying
  the `P2002`-inside-a-transaction path against real Postgres.
- `Transaction.gatewayPaymentId` is neither indexed nor `@unique`, so each webhook POST does a
  sequential scan, and the security binding is conventional rather than structural.
- A superseded charge's ref becomes unreachable once a new charge overwrites it, so its late
  webhook is silently never credited.
- "Pay again" 400s when the remainder is under the ₱200 minimum.
- The spec's 1-hour QR **countdown** needs a new column — deliberately skipped, not worth
  another live schema push right after the rename incident.
- Drop the two legacy columns (`payment_intent_id`, `paymongo_pi_id`) once merged code is live.

---

## 9. Do NOT

- **Do not re-add `npm run db:push` to the Render build command.** It rewrites the live schema
  on every deploy. It turned the rename into a production outage, then into a wedged build.
  The current build command is `npm ci --include=dev && npx prisma generate && npm run build`.
- **Do not flip `payment_gateway` to `maya` in production** before real keys exist — it hard-fails.
- **Do not trust AI-generated summaries of Maya's docs.** The `centavos` bug, the wrong sandbox
  URL, and the deprecated `CHECKOUT_*` events all came from one. Read the OpenAPI on
  `developers.maya.ph`.

---

## 10. Quick reference

```powershell
# tests
cd backend; npx vitest run              # 508 passing
npx tsc --noEmit                        # clean
cd ..\frontend; npm run build           # ok

# schema drift
cd backend
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
# exit 0 = no drift

# production
Invoke-RestMethod https://rentech-myleneboutique.vercel.app/api/health

# local backend (remember: .env changes need a restart)
cd backend; npm run dev
```

**Note:** a local dev backend may still be running from earlier work. `prisma generate` fails
with `EPERM` while one is up — stop it first.
