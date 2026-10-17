# Manual QR Payment (Static QR + Proof Review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third, admin-selectable payment path — a manual/static QR (InstaPay / GCash / bank app) where the customer scans the boutique's uploaded QR, pays, uploads a screenshot + optional reference, and staff approve or reject the proof. Approval is the ONLY event that credits money, and it credits through the existing idempotent ledger.

**Architecture:** `payment_gateway` gains the value `'manual'`. QR codes live in a `manual_qr_codes` BusinessRule (JSON string, admin-managed in Settings → Integrations). Proof submissions go into a new `PaymentProof` table (screenshot in the private bucket under `rental/<txId>/proof-<ts>.jpg`, amount server-set to the booking's downpayment). Staff see a "Payments to verify" queue on Tasks; approve calls `applyPaymentToTransaction({ gateway: 'manual', gatewayRef: 'proof_<id>', method: 'instapay' })` — the same single crediting path as PayMongo/Maya, so the `gatewayRef` unique index makes double-approval a no-op. Rejection moves nothing and lets the customer resubmit.

**Tech Stack:** TypeScript 5.8, Express 5, Prisma 6 + PostgreSQL (Supabase), zod, vitest + supertest. Frontend React 18 + Vite, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-17-manual-qr-payment-design.md` — read it before starting; this plan implements it.

---

## Global Constraints

- **Money moves exactly once.** Every credit goes through `applyPaymentToTransaction` (`backend/src/services/payments.ledger.ts`) with `gatewayRef: 'proof_<proofId>'`. A retried/double approve returns `{ duplicate: true }` and credits nothing — reconcile the proof row anyway (idempotent approve).
- **The proof amount is server-set.** `amount = tx.downpayment` at submission; never trust a client amount. The reviewer may override at approval, capped at the outstanding balance.
- **Reject = zero money movement.** The booking stays; the customer may resubmit (only one PENDING proof per booking at a time).
- **A booking with an active gateway charge cannot receive a manual proof** (`tx.gateway` non-null and ≠ `'manual'` → 400). No mixed verification paths.
- **Honesty copy is part of the theme.** Pending never reads "Paid"/"Success" — amber "submitted for review" / "under review" until staff approve.
- **All new UI matches the existing theme (explicit requirement, spec §8):** brand `#bf4a53`, white `rounded-2xl/3xl` cards with `border-gray-100/80 shadow-sm`, amber=pending / emerald=approved / red=rejected, bottom-sheet modals on mobile (mirror `ReleaseItemModal`), lucide-react only, toast feedback, no `alert()`.
- **Route ordering:** in `payments.routes.ts` the `/proofs` routes MUST be declared before `GET /:id`.
- **DDL is additive only:** `npx prisma db push --skip-generate` (routes via `DIRECT_URL`), then **stop the backend** → `npx prisma generate` → restart. Never re-add `db push` to the Render build command.
- **Do not touch PayMongo/Maya behavior.** Full backend suite (currently 626 passing) and `npx tsc --noEmit` must stay green after every task; frontend `npm run build` must pass.

## Review Focus

Inputs a reasonable person would expect to work, each pinned by a test in the task that owns the code:

1. **Double-approve / crash-retry on approve** → single credit (ledger duplicate), proof still ends `approved`, fresh totals returned. (Task 5)
2. **Underpayment guard:** reviewer overrides the amount above the outstanding balance → 400, ledger never called. (Task 5)
3. **Duplicate submission:** a second proof while one is `pending` → 409, no upload, no staff spam. (Task 4)
4. **Rejected then resubmitted** → new pending proof, booking untouched, staff re-alerted (direct `createMany`, not the deduped `notifyStaffMembers`). (Task 4)
5. **Mixed verification:** booking charged via PayMongo/Maya cannot receive a manual proof → 400. (Task 4)
6. **Manual create-intent writes no charge:** `{ gateway:'manual', qrCodes, simulated:false }` and **no** `transaction.update` / `gatewayPaymentId`. (Task 5)
7. **Cross-customer submission:** another customer's booking id → 403, no row. (Task 4)

---

## File Structure

**Backend — created**
| File | Responsibility |
|---|---|
| `backend/src/services/paymentProofs.service.ts` | Submit/approve/reject/queue — all proof business rules. Knows storage + ledger + notifications. |
| `backend/src/controllers/paymentProofs.controller.ts` | Zod schemas + thin HTTP handlers. |
| `backend/tests/manualQr.test.ts` | Entire feature's backend coverage. |

**Backend — modified**
| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | `PaymentProof` model; `Transaction.paymentPath` + `paymentProofs`; `Profile.reviewedProofs`. |
| `backend/src/services/settings.service.ts` | `getPaymentGateway()` + `'manual'`; `parseManualQrCodes` / `assertValidManualQrCodes`; `getRentalDefaults` carries `manual_qr_codes`. |
| `backend/src/controllers/settings.controller.ts` | `updateRules` validates `manual_qr_codes`. |
| `backend/src/services/payments.ledger.ts` | Gateway union `+ 'manual'`, method union `+ 'instapay'`. |
| `backend/src/services/transactions.service.ts` | `recordPayment` accepts `instapay`; `createRental` writes `paymentPath`; customer list includes latest proof. |
| `backend/src/controllers/customer.controller.ts` | `createBookingSchema` accepts `paymentPath`; `createBooking` forwards it. |
| `backend/src/controllers/payments.controller.ts` | Manual branch in `createPaymentIntent`. |
| `backend/src/routes/customer.routes.ts` | `POST /:id/payment-proof` on `bookingRouter`. |
| `backend/src/routes/payments.routes.ts` | `GET /proofs`, `POST /proofs/:id/approve`, `POST /proofs/:id/reject`. |
| `backend/src/services/backup.service.ts` + `restore.service.ts` | `payment_proofs` in export, `KNOWN_TABLES`, and the restore module. |
| `backend/tests/setup.ts` | `paymentProof` prisma mock. |

**Frontend — created**
| File | Responsibility |
|---|---|
| `frontend/src/components/ManualQrPayment.jsx` | Shared customer QR panel (chips, QR card + lightbox, reference, screenshot). Controlled inputs. |
| `frontend/src/components/PaymentProofModal.jsx` | "Upload payment proof" modal for My Rentals resume. |
| `frontend/src/components/ManualQrPanel.jsx` | Presentational QR panel for counter collection (staff). |
| `frontend/src/components/PaymentProofsQueue.jsx` | "Payments to verify" card on Tasks (Pending / Awaiting tabs). |
| `frontend/src/components/PaymentProofReviewModal.jsx` | Approve (editable amount) / reject (reason) bottom-sheet. |
| `frontend/src/components/settings/PaymentQrManager.jsx` | Admin QR list + add/edit/delete. |
| `frontend/src/hooks/usePaymentProofs.js` | Queue data + 45s poll + manual refresh (mirrors `useDashboard.js` cache pattern). |

**Frontend — modified**
| File | Change |
|---|---|
| `frontend/src/components/CustomerRentalFlow.jsx` | Manual branch in step 2 + receipt/overlay states. |
| `frontend/src/pages/DashboardView.jsx` | My Rentals badges + resume action. |
| `frontend/src/pages/StaffTasksView.jsx` | Mounts `PaymentProofsQueue` above "Ready for Pickup". |
| `frontend/src/components/ReleaseItemModal.jsx`, `TransactionDetailModal.jsx`, `pages/StaffNewRental.jsx` | Manual branch in the online-collect surface. |
| `frontend/src/components/settings/IntegrationsTab.jsx` | Gateway option + `PaymentQrManager` card. |
| `frontend/src/components/NotificationsDropdown.jsx` | 3 `TYPE_CONFIG` entries + staff routing to Tasks. |
| `frontend/src/services/payments.js` | `submitProof`, `listProofs`, `approveProof`, `rejectProof`. |
| `frontend/src/utils/demoInterceptor.js` | Demo routes + fixtures for the whole flow. |

---

## Task 1: Schema — PaymentProof + Transaction.paymentPath

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces (produces):**
- `PaymentProof` model → Prisma client `prisma.paymentProof` with fields `{ id, transactionId, amount, reference, channel, imagePath, status, rejectionReason, reviewedById, reviewedAt, createdAt }`
- `Transaction.paymentPath: string | null` (`'manual'` marks an abandoned manual checkout)
- `Transaction.paymentProofs: PaymentProof[]`, `Profile.reviewedProofs: PaymentProof[]`

- [ ] **Step 1: Edit `schema.prisma`**

In `model Transaction` (line ~164, after `gatewayPaymentId`), add:

```prisma
  // Which checkout path this booking was created through. 'manual' = static
  // QR + staff-reviewed proof (drives the awaiting-proof chase list).
  paymentPath     String?           @map("payment_path")
```

and in its relations block (after `payments Payment[]`):

```prisma
  paymentProofs PaymentProof[]
```

In `model Profile` (after `importedRecords`):

```prisma
  reviewedProofs PaymentProof[] @relation("ProofReviewer")
```

Add the new model after `model Payment`:

```prisma
// Customer-submitted manual-QR payment evidence (screenshot + reference).
// Approval is the only event that credits money; it flows through
// payments.ledger.ts with gatewayRef = 'proof_<id>' so a double-approve is
// idempotent. Rejection moves nothing and allows a new submission.
model PaymentProof {
  id              String    @id @default(uuid())
  transactionId   String    @map("transaction_id")
  amount          Float
  reference       String?
  channel         String?
  imagePath       String    @map("image_path")
  status          String    @default("pending")
  rejectionReason String?   @map("rejection_reason")
  reviewedById    String?   @map("reviewed_by_id")
  reviewedAt      DateTime? @map("reviewed_at")
  createdAt       DateTime  @default(now()) @map("created_at")

  transaction Transaction @relation(fields: [transactionId], references: [id])
  reviewedBy  Profile?    @relation("ProofReviewer", fields: [reviewedById], references: [id])

  @@index([status, createdAt])
  @@index([transactionId])
  @@index([reviewedById])
  @@map("payment_proofs")
}
```

- [ ] **Step 2: Push (additive) and regenerate**

```powershell
# in backend/
npx prisma db push --skip-generate
# verify zero drift:
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Then **stop the dev backend** (EPERM on the engine DLL), run `npx prisma generate`, restart the backend.

If `db push` hangs (pooler), see the spec §4 fallback: targeted `prisma db execute` SQL (CREATE TABLE + ADD COLUMN + indexes).

- [ ] **Step 3: Verify compile + suite untouched**

```powershell
npx tsc --noEmit
npx vitest run
```

Expected: clean, 626/626 (no behavior changed yet).

- [ ] **Step 4: Commit**

```
git add backend/prisma/schema.prisma
git commit -m "feat(payments): PaymentProof model + Transaction.paymentPath (manual QR)"
```

---

## Task 2: Settings — gateway 'manual', QR parse/validate, rental-defaults

**Files:**
- Modify: `backend/src/services/settings.service.ts`
- Modify: `backend/src/controllers/settings.controller.ts` (`updateRules`, line ~64)
- Test: `backend/tests/manualQr.test.ts` (new)

**Interfaces (produces):**
- `type ManualQrCode = { id: string; label: string; accountName: string; imagePath: string }`
- `parseManualQrCodes(raw: string | undefined | null): ManualQrCode[]` — tolerant, never throws, drops invalid entries, max 10
- `assertValidManualQrCodes(raw: string): ManualQrCode[]` — throws `AppError(400, …)`
- `getPaymentGateway(): Promise<'paymongo' | 'maya' | 'manual'>`
- `getRentalDefaults()` now returns `payment_gateway: 'manual'|'maya'|'paymongo'` and `manual_qr_codes: ManualQrCode[]`

- [ ] **Step 1: Write the failing tests** in `backend/tests/manualQr.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  getPaymentGateway,
  getRentalDefaults,
  parseManualQrCodes,
  assertValidManualQrCodes,
} from '../src/services/settings.service.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

const QR = { id: 'gcash-1', label: 'GCash', accountName: 'Mylene S.', imagePath: 'qrcodes/gcash-1.webp' };

describe('getPaymentGateway manual', () => {
  it('returns manual when the rule says so', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([{ key: 'payment_gateway', value: 'manual' }]);
    expect(await getPaymentGateway()).toBe('manual');
  });
});

describe('parseManualQrCodes', () => {
  it('parses a valid list', () => {
    expect(parseManualQrCodes(JSON.stringify([QR]))).toEqual([QR]);
  });
  it('tolerates garbage without throwing', () => {
    expect(parseManualQrCodes('not-json')).toEqual([]);
    expect(parseManualQrCodes(undefined)).toEqual([]);
    expect(parseManualQrCodes(JSON.stringify([{ id: 'x' }, QR]))).toEqual([QR]);
    // path traversal / absolute URLs are not allowed
    expect(parseManualQrCodes(JSON.stringify([{ ...QR, imagePath: '../secrets' }]))).toEqual([]);
    expect(parseManualQrCodes(JSON.stringify([{ ...QR, imagePath: 'https://evil/x.png' }]))).toEqual([]);
  });
});

describe('assertValidManualQrCodes', () => {
  it('returns the parsed list for valid input', () => {
    expect(assertValidManualQrCodes(JSON.stringify([QR]))).toEqual([QR]);
  });
  it('throws 400 on malformed JSON / non-array / invalid entries', () => {
    expect(() => assertValidManualQrCodes('oops')).toThrow(/valid JSON/);
    expect(() => assertValidManualQrCodes('{}')).toThrow(/array/);
    expect(() => assertValidManualQrCodes(JSON.stringify([{ id: '', label: '', accountName: '', imagePath: '' }]))).toThrow(/Invalid QR/);
  });
});

describe('GET /api/settings/rental-defaults with manual gateway', () => {
  it('carries the parsed QR list and the manual gateway', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([
      { key: 'payment_gateway', value: 'manual' },
      { key: 'manual_qr_codes', value: JSON.stringify([QR]) },
    ]);
    const res = await request(app).get('/api/settings/rental-defaults');
    expect(res.status).toBe(200);
    expect(res.body.payment_gateway).toBe('manual');
    expect(res.body.manual_qr_codes).toEqual([QR]);
  });

  it('defaults manual_qr_codes to [] when unset', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/settings/rental-defaults');
    expect(res.body.manual_qr_codes).toEqual([]);
  });
});

describe('PUT /api/settings/rules validates manual_qr_codes', () => {
  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .put('/api/settings/rules')
      .set('Authorization', 'Bearer admin-token')
      .send({ manual_qr_codes: 'not-json' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```powershell
npx vitest run tests/manualQr.test.ts
```

- [ ] **Step 3: Implement in `settings.service.ts`**

Add near the top (after `getBusinessRules`):

```ts
export type ManualQrCode = { id: string; label: string; accountName: string; imagePath: string };

const MAX_QR_CODES = 10;
const QR_PATH_RE = /^qrcodes\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const isValidQrEntry = (q: unknown): q is ManualQrCode => {
  if (!q || typeof q !== 'object') return false;
  const e = q as Record<string, unknown>;
  return (
    typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 64 &&
    typeof e.label === 'string' && e.label.length > 0 && e.label.length <= 40 &&
    typeof e.accountName === 'string' && e.accountName.length <= 60 &&
    typeof e.imagePath === 'string' && e.imagePath.length <= 220 &&
    !e.imagePath.includes('..') && QR_PATH_RE.test(e.imagePath)
  );
};

// Tolerant reader for the public rental-defaults endpoint — bad or partial
// data degrades to [] / dropped entries, it never throws.
export function parseManualQrCodes(raw: string | undefined | null): ManualQrCode[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidQrEntry).slice(0, MAX_QR_CODES);
  } catch {
    return [];
  }
}

// Strict validator for PUT /settings/rules — an admin typo must 400, not
// silently produce a customer-facing empty QR panel.
export function assertValidManualQrCodes(raw: string): ManualQrCode[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(400, 'manual_qr_codes must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new AppError(400, 'manual_qr_codes must be a JSON array');
  if (parsed.length > MAX_QR_CODES) throw new AppError(400, `At most ${MAX_QR_CODES} QR codes are allowed`);
  const codes = parseManualQrCodes(raw);
  if (codes.length !== parsed.length) {
    throw new AppError(400, 'Invalid QR entry — id, label, accountName and imagePath are required (imagePath must start with qrcodes/)');
  }
  return codes;
}
```

Update `getPaymentGateway`:

```ts
export async function getPaymentGateway(): Promise<'paymongo' | 'maya' | 'manual'> {
  const rules = await getBusinessRules();
  if (rules.payment_gateway === 'maya') return 'maya';
  if (rules.payment_gateway === 'manual') return 'manual';
  return 'paymongo';
}
```

Update `getRentalDefaults` (line ~26). **Do NOT call `getPaymentGateway()` here** — that would add a second `businessRule.findMany` read and break the existing `maya.test.ts` rental-defaults tests (they mock exactly one read). Derive inline from the already-loaded `rules`:

```ts
    payment_gateway: rules.payment_gateway === 'maya' ? 'maya' : rules.payment_gateway === 'manual' ? 'manual' : 'paymongo',
    manual_qr_codes: parseManualQrCodes(rules.manual_qr_codes),
```

(keep the existing store_* fields; `rules` is already loaded in that function).

- [ ] **Step 4: Implement the controller validation** in `settings.controller.ts` `updateRules` (line ~64), before `updateBusinessRules`:

```ts
    if (typeof req.body.manual_qr_codes === 'string') {
      settingsService.assertValidManualQrCodes(req.body.manual_qr_codes);
    }
```

- [ ] **Step 5: Run tests + typecheck + full suite**

```powershell
npx vitest run tests/manualQr.test.ts && npx tsc --noEmit && npx vitest run
```

Expected: new tests pass; full suite still green (`settings.test.ts` and `maya.test.ts` unaffected — `'manual'` only adds a branch).

- [ ] **Step 6: Commit**

```
git add backend/src/services/settings.service.ts backend/src/controllers/settings.controller.ts backend/tests/manualQr.test.ts
git commit -m "feat(settings): manual QR gateway + validated manual_qr_codes rule"
```

---

## Task 3: Ledger + counter record accept 'manual' / 'instapay'

**Files:**
- Modify: `backend/src/services/payments.ledger.ts` (type unions, lines 26–32)
- Modify: `backend/src/services/transactions.service.ts` (`recordPayment` `validMethods`, line ~1246)
- Test: extend `backend/tests/manualQr.test.ts`

**Interfaces:**
- `applyPaymentToTransaction(input: { …, gateway: 'paymongo' | 'maya' | 'manual'; method: 'gcash' | 'card' | 'maya' | 'instapay' })`
- `recordPayment(…, method)` accepts `'instapay'`

- [ ] **Step 1: Write failing tests** (append to `manualQr.test.ts`)

```ts
import { applyPaymentToTransaction } from '../src/services/payments.ledger.js';

describe('ledger credits a manual proof', () => {
  it('writes a manual/instapay payment row and moves totals', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, balance: 5000,
    });
    prisma.payment.findUnique.mockResolvedValueOnce(null);

    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 5000, gateway: 'manual', gatewayRef: 'proof_p1', method: 'instapay',
    });

    expect(result).toMatchObject({ duplicate: false, totalPaid: 5000, balance: 0 });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'manual', gatewayRef: 'proof_p1', method: 'instapay', status: 'succeeded' }),
    }));
  });

  it('treats a repeated gatewayRef as a duplicate', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, totalPaid: 5000, balance: 0, latePenalty: 0, damageFee: 0,
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'pay-existing' });
    const result = await applyPaymentToTransaction({
      transactionId: 'tx-1', amount: 5000, gateway: 'manual', gatewayRef: 'proof_p1', method: 'instapay',
    });
    expect(result.duplicate).toBe(true);
  });
});
```

Plus a `recordPayment` acceptance test:

```ts
import { recordPayment } from '../src/services/transactions.service.js';

describe('recordPayment accepts instapay', () => {
  it('rejects an unknown method', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, totalPaid: 0, latePenalty: 0, damageFee: 0, payments: [],
    });
    await expect(recordPayment('tx-1', 'staff-1', 200, 'bitcoin')).rejects.toThrow(/Invalid payment method/);
  });

  it('accepts instapay', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, totalPaid: 0, latePenalty: 0, damageFee: 0, payments: [],
    });
    // recordPayment uses the ARRAY form of $transaction — the default mock only
    // supports the callback form, so resolve it explicitly for this test.
    (prisma.$transaction as any).mockResolvedValueOnce([
      { id: 'pay-1', amount: 200, method: 'instapay' },
      { id: 'tx-1', totalPaid: 200, balance: 4800 },
    ]);
    await expect(recordPayment('tx-1', 'staff-1', 200, 'instapay')).resolves.toBeDefined();
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: 'instapay' }),
    }));
  });
});
```

- [ ] **Step 2: Run to confirm failures** — `npx vitest run tests/manualQr.test.ts`

- [ ] **Step 3: Implement**
  - `payments.ledger.ts`: widen the unions (`gateway: 'paymongo' | 'maya' | 'manual'`, `method: 'gcash' | 'card' | 'maya' | 'instapay'`). No logic change — the function is provider-agnostic.
  - `transactions.service.ts` line ~1246: `const validMethods = ['cash', 'gcash', 'card', 'instapay'];`

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run tests/manualQr.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```
git add backend/src/services/payments.ledger.ts backend/src/services/transactions.service.ts backend/tests/manualQr.test.ts
git commit -m "feat(payments): ledger + recordPayment support manual/instapay"
```

---

## Task 4: Proof submission — service, controller, customer route

**Files:**
- Create: `backend/src/services/paymentProofs.service.ts`
- Create: `backend/src/controllers/paymentProofs.controller.ts`
- Modify: `backend/src/routes/customer.routes.ts`
- Modify: `backend/src/controllers/customer.controller.ts` (`createBookingSchema` + `createBooking`)
- Modify: `backend/src/services/transactions.service.ts` (`createRental` writes `paymentPath`)
- Modify: `backend/tests/setup.ts` (add `paymentProof` mock)
- Test: extend `backend/tests/manualQr.test.ts`

**Interfaces (produces):**
- `submitProof(transactionId, customerId, { data, contentType, reference?, channel? }): Promise<ProofSummary>` — full guard chain per spec §5.1, 5 MB decoded cap, uploads to `rental/<txId>/proof-<Date.now()>.jpg`, inserts row (`amount = tx.downpayment`), sets `paymentPath='manual'`, notifies Staff+Admin via direct `createMany`.
- `POST /api/bookings/:id/payment-proof` → 201 `{ proof: ProofSummary }`; rate-limited 10/hour.
- `createRental(data)` accepts `paymentPath?: 'manual'` and stores it.

- [ ] **Step 1: Add the `paymentProof` prisma mock** to `backend/tests/setup.ts` (next to `payment:`)

```ts
    paymentProof: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'proof-new', status: 'pending', createdAt: new Date(), ...args.data })),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
```

- [ ] **Step 2: Write failing tests** (append to `manualQr.test.ts`)

Add the storage partial mock at the top of the file (must come before other imports for hoisting):

```ts
vi.mock('../src/services/storage.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/storage.service.js')>();
  return { ...actual, uploadFile: vi.fn() };
});
```

Helper + cases:

```ts
const proofBody = {
  data: Buffer.from('fake-image-bytes').toString('base64'),
  contentType: 'image/jpeg',
  reference: '000123456789',
  channel: 'gcash-1',
};

const manualTx = {
  id: 'tx-1', txNumber: 1001, status: 'Active', customerId: 'auth-customer-id',
  rentalFee: 5000, downpayment: 200, totalPaid: 0, balance: 5000, gateway: null, paymentPath: null,
  item: { name: 'Barong' }, customer: { name: 'Ana' },
};

describe('POST /api/bookings/:id/payment-proof', () => {
  it('uploads, stores, marks paymentPath, and alerts staff+admin', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { uploadFile } = await import('../src/services/storage.service.js');
    (uploadFile as any).mockResolvedValueOnce({ path: 'rental/tx-1/proof-1.webp', thumbPath: null, public: false });
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx });
    prisma.paymentProof.findFirst.mockResolvedValueOnce(null);
    prisma.profile.findMany.mockResolvedValueOnce([{ id: 'staff-1' }, { id: 'admin-1' }]);

    const res = await request(app)
      .post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token')
      .send(proofBody);

    expect(res.status).toBe(201);
    expect(res.body.proof).toMatchObject({ status: 'pending', amount: 200, reference: '000123456789' });
    expect(prisma.paymentProof.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transactionId: 'tx-1', amount: 200, imagePath: 'rental/tx-1/proof-1.webp' }),
    }));
    expect(prisma.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' }, data: { paymentPath: 'manual' },
    }));
    expect(prisma.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ profileId: 'staff-1', type: 'payment_proof' })]),
    }));
  });

  it('403s another customer\'s booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx, customerId: 'someone-else' });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(403);
    expect(prisma.paymentProof.create).not.toHaveBeenCalled();
  });

  it('400s a cancelled booking', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx, status: 'Cancelled' });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(400);
  });

  it('400s when the downpayment is already settled', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx, totalPaid: 200 });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(400);
  });

  it('400s a booking with an active gateway charge', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx, gateway: 'maya' });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(400);
  });

  it('409s while a proof is already pending', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx });
    prisma.paymentProof.findFirst.mockResolvedValueOnce({ id: 'proof-live', status: 'pending' });
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send(proofBody);
    expect(res.status).toBe(409);
  });

  it('400s an oversize screenshot before uploading', async () => {
    const { prisma } = await import('../src/config/database.js');
    const { uploadFile } = await import('../src/services/storage.service.js');
    prisma.transaction.findUnique.mockResolvedValueOnce({ ...manualTx });
    prisma.paymentProof.findFirst.mockResolvedValueOnce(null);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
    const res = await request(app).post('/api/bookings/tx-1/payment-proof')
      .set('Authorization', 'Bearer customer-token').send({ ...proofBody, data: big });
    expect(res.status).toBe(400);
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to confirm failures** — `npx vitest run tests/manualQr.test.ts`

- [ ] **Step 4: Create `backend/src/services/paymentProofs.service.ts`**

```ts
import { prisma } from '../config/database.js';
import * as storageService from './storage.service.js';
import { AppError } from '../middleware/errorHandler.js';
// Task 5 adds: applyPaymentToTransaction, createNotification, createAuditLog

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export type ProofSummary = {
  id: string;
  status: string;
  amount: number;
  reference: string | null;
  channel: string | null;
  createdAt: Date;
};

export async function submitProof(
  transactionId: string,
  customerId: string,
  input: { data: string; contentType: string; reference?: string; channel?: string },
): Promise<ProofSummary> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { item: { select: { name: true } }, customer: { select: { name: true } } },
  });
  if (!tx) throw new AppError(404, 'Booking not found');
  if (tx.customerId !== customerId) throw new AppError(403, 'Not your booking');
  if (tx.status === 'Cancelled') throw new AppError(400, 'This booking was cancelled');
  if (tx.downpayment <= 0 || tx.totalPaid >= tx.downpayment) {
    throw new AppError(400, 'The downpayment is already settled for this booking');
  }
  if (tx.gateway && tx.gateway !== 'manual') {
    throw new AppError(400, 'This booking is being paid through an online gateway');
  }
  const pending = await prisma.paymentProof.findFirst({ where: { transactionId, status: 'pending' } });
  if (pending) throw new AppError(409, 'A payment proof is already under review for this booking');

  const buffer = Buffer.from(input.data, 'base64');
  if (buffer.length === 0) throw new AppError(400, 'Empty image data');
  if (buffer.length > MAX_PROOF_BYTES) throw new AppError(400, 'Screenshot must be 5 MB or smaller');

  const { path } = await storageService.uploadFile(
    `rental/${transactionId}/proof-${Date.now()}.jpg`,
    input.contentType,
    buffer,
  );

  const proof = await prisma.paymentProof.create({
    data: {
      transactionId,
      amount: tx.downpayment,
      reference: input.reference?.trim() || null,
      channel: input.channel?.trim() || null,
      imagePath: path,
      status: 'pending',
    },
  });

  // Idempotent marker for the "awaiting proof" chase list + My Rentals resume.
  if (tx.paymentPath !== 'manual') {
    await prisma.transaction.update({ where: { id: transactionId }, data: { paymentPath: 'manual' } });
  }

  // Direct fan-out — bypasses notifyStaffMembers' dedupe so every
  // resubmission re-alerts.
  const staff = await prisma.profile.findMany({
    where: { role: { in: ['Staff', 'Admin'] } },
    select: { id: true },
  });
  if (staff.length > 0) {
    await prisma.notification.createMany({
      data: staff.map((s) => ({
        profileId: s.id,
        transactionId,
        type: 'payment_proof',
        title: 'New payment proof',
        message: `${tx.customer?.name ?? 'A customer'} submitted a ₱${tx.downpayment.toLocaleString()} payment proof for ${tx.item?.name ?? 'an item'} — review it in Tasks.`,
      })),
    });
  }

  return {
    id: proof.id,
    status: proof.status,
    amount: proof.amount,
    reference: proof.reference ?? null,
    channel: proof.channel ?? null,
    createdAt: proof.createdAt,
  };
}
```

(`approveProof` / `rejectProof` / `listProofQueue` are Task 5 — do not add them yet.)

- [ ] **Step 5: Create the controller** — `backend/src/controllers/paymentProofs.controller.ts`

```ts
import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as paymentProofsService from '../services/paymentProofs.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const submitProofSchema = z.object({
  body: z.object({
    // ~7.1M chars ≈ 5MB decoded; the exact byte cap is enforced on the buffer.
    data: z.string().min(1).max(7_100_000),
    contentType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
    reference: z.string().max(40).optional(),
    channel: z.string().max(40).optional(),
  }),
});

export async function submitProof(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const proof = await paymentProofsService.submitProof(req.params.id, req.user.id, req.body);
    res.status(201).json({ proof });
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 6: Wire the route** in `customer.routes.ts`

Import the controller and add to `bookingRouter` (after `bookingRouter.post('/', …)`):

```ts
bookingRouter.post(
  '/:id/payment-proof',
  createRateLimiter(10, 3_600_000),
  validate(paymentProofsController.submitProofSchema),
  paymentProofsController.submitProof,
);
```

- [ ] **Step 7: `paymentPath` through booking creation**

`customer.controller.ts`:
- `createBookingSchema.body` gains `paymentPath: z.enum(['manual']).optional(),`
- `createBooking` destructures it and forwards `paymentPath` into `createRental`.

`transactions.service.ts`:
- `CreateRentalInput` gains `paymentPath?: 'manual';`
- In the `prisma.transaction.create` data (inside `createRental`), add:
  `paymentPath: data.paymentPath === 'manual' ? 'manual' : null,`

- [ ] **Step 8: Run tests + typecheck** — `npx vitest run tests/manualQr.test.ts && npx tsc --noEmit`

- [ ] **Step 9: Commit**

```
git add backend/src/services/paymentProofs.service.ts backend/src/controllers/paymentProofs.controller.ts backend/src/routes/customer.routes.ts backend/src/controllers/customer.controller.ts backend/src/services/transactions.service.ts backend/tests/setup.ts backend/tests/manualQr.test.ts
git commit -m "feat(payments): manual QR proof submission endpoint"
```

---

## Task 5: Proof review — queue, approve, reject, create-intent manual branch, customer list include

**Files:**
- Modify: `backend/src/services/paymentProofs.service.ts` (add `listProofQueue`, `approveProof`, `rejectProof`)
- Modify: `backend/src/controllers/paymentProofs.controller.ts` (schemas + handlers)
- Modify: `backend/src/routes/payments.routes.ts`
- Modify: `backend/src/controllers/payments.controller.ts` (manual branch in `createPaymentIntent`)
- Modify: `backend/src/services/transactions.service.ts` (customer list latest-proof include)
- Test: extend `backend/tests/manualQr.test.ts`

**Interfaces (produces):**
- `listProofQueue(limit = 50): Promise<{ pending, awaiting, counts: { pending, awaiting } }>` (shapes per spec §5.2)
- `approveProof(proofId, reviewerId, amountOverride?): Promise<{ proof, totalPaid, balance }>`
- `rejectProof(proofId, reviewerId, reason): Promise<{ proof }>`
- `GET /api/payments/proofs`, `POST /api/payments/proofs/:id/approve`, `POST /api/payments/proofs/:id/reject` (Staff/Admin)
- `create-intent` manual → `{ gateway: 'manual', amount, qrCodes, simulated: false }`
- Customer booking lists carry `paymentProofs: [{ status, rejectionReason, amount, createdAt }]` (latest only)

- [ ] **Step 1: Write failing tests** (append)

```ts
describe('proof review', () => {
  const pendingProof = {
    id: 'proof-1', status: 'pending', amount: 200, reference: 'R1', channel: 'gcash-1',
    createdAt: new Date(), transaction: {
      id: 'tx-1', txNumber: 1001, status: 'Active', customerId: 'auth-customer-id',
      rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, downpayment: 200,
      item: { name: 'Barong' },
    },
  };

  it('GET /proofs requires staff or admin', async () => {
    const res = await request(app).get('/api/payments/proofs').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(403);
  });

  it('GET /proofs returns pending rows and awaiting bookings', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findMany.mockResolvedValueOnce([pendingProof]);
    prisma.paymentProof.count.mockResolvedValueOnce(1);
    prisma.transaction.findMany.mockResolvedValueOnce([{
      id: 'tx-9', txNumber: 1009, downpayment: 200, totalPaid: 0, balance: 5000,
      status: 'Reserved', rentalDate: new Date(), dueDate: new Date(),
      item: { name: 'Gown' }, customer: { id: 'c1', name: 'Bea', phone: '0917' },
      paymentProofs: [{ status: 'rejected', rejectionReason: 'Blurry', createdAt: new Date() }],
    }]);
    const res = await request(app).get('/api/payments/proofs').set('Authorization', 'Bearer staff-token');
    expect(res.status).toBe(200);
    expect(res.body.pending).toHaveLength(1);
    expect(res.body.awaiting).toHaveLength(1);
    expect(res.body.counts).toEqual({ pending: 1, awaiting: 1 });
  });

  it('approve credits through the ledger and reconciles the proof', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce(pendingProof);   // service read
    prisma.transaction.findUnique.mockResolvedValueOnce({                 // ledger read
      id: 'tx-1', status: 'Active', rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 0, balance: 5000,
    });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/approve')
      .set('Authorization', 'Bearer staff-token')
      .send({ amount: 200 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalPaid: 200, balance: 4800 });
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway: 'manual', gatewayRef: 'proof_proof-1', method: 'instapay', amount: 200 }),
    }));
    expect(prisma.paymentProof.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'proof-1', status: 'pending' },
      data: expect.objectContaining({ status: 'approved' }),
    }));
  });

  it('approve is idempotent (duplicate ledger result still reconciles)', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce(pendingProof);
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', rentalFee: 5000, latePenalty: 0, damageFee: 0, totalPaid: 200, balance: 4800,
    });
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'pay-existing' }); // already credited
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/approve')
      .set('Authorization', 'Bearer admin-token')
      .send({});
    expect(res.status).toBe(200);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.paymentProof.updateMany).toHaveBeenCalled();
  });

  it('approve 400s an amount above the outstanding balance', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce(pendingProof);
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/approve')
      .set('Authorization', 'Bearer staff-token')
      .send({ amount: 999999 });
    expect(res.status).toBe(400);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('approve 409s a non-pending proof', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce({ ...pendingProof, status: 'rejected' });
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/approve')
      .set('Authorization', 'Bearer staff-token')
      .send({});
    expect(res.status).toBe(409);
  });

  it('reject stores the reason, notifies the customer, moves no money', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.paymentProof.findUnique.mockResolvedValueOnce(pendingProof);
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/reject')
      .set('Authorization', 'Bearer staff-token')
      .send({ reason: 'Screenshot is blurry' });
    expect(res.status).toBe(200);
    expect(prisma.paymentProof.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'rejected', rejectionReason: 'Screenshot is blurry' }),
    }));
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'payment_proof_rejected' }),
    }));
  });

  it('reject 400s a too-short reason (zod)', async () => {
    const res = await request(app)
      .post('/api/payments/proofs/proof-1/reject')
      .set('Authorization', 'Bearer staff-token')
      .send({ reason: 'no' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/payments/create-intent manual branch', () => {
  it('returns qrCodes without charging or writing a gateway id', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findMany
      .mockResolvedValueOnce([{ key: 'min_downpayment', value: '200' }])
      .mockResolvedValueOnce([{ key: 'payment_gateway', value: 'manual' }])
      .mockResolvedValueOnce([{ key: 'manual_qr_codes', value: JSON.stringify([{ id: 'gcash-1', label: 'GCash', accountName: 'Mylene S.', imagePath: 'qrcodes/gcash-1.webp' }]) }]);
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-1', status: 'Active', downpayment: 200, totalPaid: 0,
      rentalFee: 5000, latePenalty: 0, damageFee: 0, balance: 5000, payments: [],
    });
    const res = await request(app)
      .post('/api/payments/create-intent')
      .set('Authorization', 'Bearer customer-token')
      .send({ transactionId: 'tx-1', amount: 200 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gateway: 'manual', amount: 200, simulated: false });
    expect(res.body.qrCodes).toHaveLength(1);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });
});

describe('customer booking list carries the latest proof', () => {
  it('includes one paymentProof on the customer path', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/bookings').set('Authorization', 'Bearer customer-token');
    expect(res.status).toBe(200);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ paymentProofs: expect.anything() }),
    }));
  });
});
```

- [ ] **Step 2: Run to confirm failures** — `npx vitest run tests/manualQr.test.ts`

- [ ] **Step 3: Implement the service functions** (first add the imports `applyPaymentToTransaction`, `createNotification`, `createAuditLog` at the top of `paymentProofs.service.ts`, then append the functions)

```ts
export async function listProofQueue(limit = 50) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [pendingRows, pendingCount, manualTx] = await Promise.all([
    prisma.paymentProof.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        transaction: {
          select: {
            id: true, txNumber: true, status: true, downpayment: true, totalPaid: true, balance: true,
            rentalDate: true, dueDate: true,
            item: { select: { name: true } },
            customer: { select: { id: true, name: true, phone: true, address: true } },
          },
        },
      },
    }),
    prisma.paymentProof.count({ where: { status: 'pending' } }),
    prisma.transaction.findMany({
      where: { paymentPath: 'manual', status: { in: ['Active', 'Reserved'] } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        item: { select: { name: true } },
        customer: { select: { id: true, name: true, phone: true } },
        paymentProofs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, rejectionReason: true, createdAt: true },
        },
      },
    }),
  ]);

  const awaiting = manualTx
    .filter((t) => t.totalPaid < t.downpayment && t.paymentProofs[0]?.status !== 'pending')
    .map((t) => ({
      id: t.id, txNumber: t.txNumber, downpayment: t.downpayment, totalPaid: t.totalPaid,
      balance: t.balance, rentalDate: t.rentalDate, dueDate: t.dueDate,
      item: t.item, customer: t.customer, latestProof: t.paymentProofs[0] ?? null,
    }))
    .slice(0, take);

  return { pending: pendingRows, awaiting, counts: { pending: pendingCount, awaiting: awaiting.length } };
}

export async function approveProof(proofId: string, reviewerId: string, amountOverride?: number) {
  const proof = await prisma.paymentProof.findUnique({
    where: { id: proofId },
    include: {
      transaction: {
        select: {
          id: true, txNumber: true, status: true, customerId: true,
          rentalFee: true, latePenalty: true, damageFee: true, totalPaid: true, downpayment: true,
          item: { select: { name: true } },
        },
      },
    },
  });
  if (!proof) throw new AppError(404, 'Payment proof not found');
  if (proof.status !== 'pending') throw new AppError(409, 'This proof was already reviewed');
  const tx = proof.transaction;
  if (tx.status === 'Cancelled') throw new AppError(400, 'This booking was cancelled');

  const amount = amountOverride ?? proof.amount;
  const outstanding = Math.max(0, tx.rentalFee + tx.latePenalty + tx.damageFee - tx.totalPaid);
  if (!(amount > 0)) throw new AppError(400, 'Amount must be greater than 0');
  if (amount > outstanding) {
    throw new AppError(400, `Amount exceeds the outstanding balance of ₱${outstanding.toLocaleString()}`);
  }

  const credit = await applyPaymentToTransaction({
    transactionId: tx.id,
    amount,
    gateway: 'manual',
    gatewayRef: `proof_${proof.id}`,
    method: 'instapay',
  });

  // Conditional reconcile — a racing reject loses cleanly.
  const updated = await prisma.paymentProof.updateMany({
    where: { id: proof.id, status: 'pending' },
    data: { status: 'approved', reviewedById: reviewerId, reviewedAt: new Date() },
  });
  if (updated.count === 0) {
    const fresh = await prisma.paymentProof.findUnique({ where: { id: proof.id } });
    if (fresh?.status !== 'approved') throw new AppError(409, 'This proof was just reviewed by someone else');
  }

  await createNotification({
    profileId: tx.customerId,
    transactionId: tx.id,
    type: 'payment_proof_approved',
    title: 'Payment verified',
    message: `We verified your payment of ₱${amount.toLocaleString()} for ${tx.item?.name ?? 'your booking'}. Your booking is confirmed.`,
  });

  await createAuditLog({
    action: 'payment_proof.approve',
    entity: 'payment_proof',
    entityId: proof.id,
    performedById: reviewerId,
    newValue: { transactionId: tx.id, amount, gatewayRef: `proof_${proof.id}` },
  });

  return {
    proof: {
      id: proof.id, status: 'approved', amount, reference: proof.reference,
      channel: proof.channel, createdAt: proof.createdAt,
    },
    totalPaid: credit.totalPaid,
    balance: credit.balance,
  };
}

export async function rejectProof(proofId: string, reviewerId: string, reason: string) {
  const proof = await prisma.paymentProof.findUnique({
    where: { id: proofId },
    include: {
      transaction: {
        select: { id: true, txNumber: true, customerId: true, item: { select: { name: true } } },
      },
    },
  });
  if (!proof) throw new AppError(404, 'Payment proof not found');
  if (proof.status !== 'pending') throw new AppError(409, 'This proof was already reviewed');

  const updated = await prisma.paymentProof.updateMany({
    where: { id: proof.id, status: 'pending' },
    data: { status: 'rejected', rejectionReason: reason, reviewedById: reviewerId, reviewedAt: new Date() },
  });
  if (updated.count === 0) throw new AppError(409, 'This proof was just reviewed by someone else');

  await createNotification({
    profileId: proof.transaction.customerId,
    transactionId: proof.transaction.id,
    type: 'payment_proof_rejected',
    title: 'Payment proof needs attention',
    message: `We couldn't verify your payment for ${proof.transaction.item?.name ?? 'your booking'}: ${reason}. You can upload a new proof from My Rentals.`,
  });

  await createAuditLog({
    action: 'payment_proof.reject',
    entity: 'payment_proof',
    entityId: proof.id,
    performedById: reviewerId,
    newValue: { reason },
  });

  return {
    proof: {
      id: proof.id, status: 'rejected', rejectionReason: reason, amount: proof.amount,
      reference: proof.reference, channel: proof.channel, createdAt: proof.createdAt,
    },
  };
}
```

- [ ] **Step 4: Controller schemas + handlers** (append to `paymentProofs.controller.ts`)

```ts
export const approveProofSchema = z.object({
  body: z.object({ amount: z.coerce.number().positive().optional() }),
});

export const rejectProofSchema = z.object({
  body: z.object({ reason: z.string().min(5).max(300) }),
});

export async function listProofs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await paymentProofsService.listProofQueue(Number(req.query.limit) || 50));
  } catch (err) {
    next(err);
  }
}

export async function approveProof(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    res.json(await paymentProofsService.approveProof(req.params.id, req.user.id, req.body.amount));
  } catch (err) {
    next(err);
  }
}

export async function rejectProof(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    res.json(await paymentProofsService.rejectProof(req.params.id, req.user.id, req.body.reason));
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 5: Routes** in `payments.routes.ts` — **before `router.get('/:id', …)`**:

```ts
import * as paymentProofsController from '../controllers/paymentProofs.controller.js';
...
router.get('/proofs', authMiddleware, requireRole(Role.Admin, Role.Staff), paymentProofsController.listProofs);
router.post('/proofs/:id/approve', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(paymentProofsController.approveProofSchema), paymentProofsController.approveProof);
router.post('/proofs/:id/reject', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(paymentProofsController.rejectProofSchema), paymentProofsController.rejectProof);
```

- [ ] **Step 6: `create-intent` manual branch** in `payments.controller.ts` `createPaymentIntent` — after the amount-bounds checks and gateway selection, before the PayMongo/Maya charge creation:

```ts
    if (gateway === 'manual') {
      const rules = await settingsService.getBusinessRules();
      return res.json({
        gateway: 'manual',
        amount,
        qrCodes: settingsService.parseManualQrCodes(rules.manual_qr_codes),
        simulated: false,
      });
    }
```

(No `transaction.update`, no gatewayPaymentId — spec §5.5.)

- [ ] **Step 7: Customer list include** in `transactions.service.ts`

Change `listTransactionsUncached` to accept the flag and add the include:

```ts
async function listTransactionsUncached(where: Record<string, unknown>, take: number, skip: number, includeLatestProof = false) {
  return prisma.transaction.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
      item: { select: { id: true, name: true, category: true } },
      ...(includeLatestProof
        ? {
            paymentProofs: {
              orderBy: { createdAt: 'desc' as const },
              take: 1,
              select: { status: true, rejectionReason: true, amount: true, createdAt: true },
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  });
}
```

and in `listTransactions` (`compute`, line ~479):

```ts
  const compute = () => listTransactionsUncached(where, params.limit ?? 500, params.offset || 0, params.role === 'Customer');
```

- [ ] **Step 8: Run tests + typecheck + full suite**

```powershell
npx vitest run tests/manualQr.test.ts && npx tsc --noEmit && npx vitest run
```

Watch `tests/payments.test.ts` + `tests/maya.test.ts`: the manual branch must not shift existing gateway behavior. The customer-list include change touches `tests/transactions.test.ts`/`customer.test.ts` expectations only if they assert exact `include` objects — fix any such assertion to use `expect.objectContaining`.

- [ ] **Step 9: Commit**

```
git add backend/src/services/paymentProofs.service.ts backend/src/controllers/paymentProofs.controller.ts backend/src/routes/payments.routes.ts backend/src/controllers/payments.controller.ts backend/src/services/transactions.service.ts backend/tests/manualQr.test.ts
git commit -m "feat(payments): proof review queue, approve/reject, manual create-intent"
```

---

## Task 6: Backup + restore support for payment_proofs

**Files:**
- Modify: `backend/src/services/backup.service.ts` (`collectBackupData`, line ~100)
- Modify: `backend/src/services/restore.service.ts` (`KNOWN_TABLES`, `models()`, new module)
- Test: extend `backend/tests/backup.test.ts` (follow its existing round-trip pattern)

**Interfaces:**
- Backup JSON gains `payment_proofs: PaymentProof[]`
- Restore accepts `payment_proofs` (parent transaction required → else skip; missing reviewer → nulled)

- [ ] **Step 1: `backup.service.ts`** — add `paymentProofs` to the `Promise.all` destructure + `safeFind`, and `payment_proofs: paymentProofs` to the return object:

```ts
      safeFind(() => p.paymentProof?.findMany?.({}) ?? Promise.resolve([])),
```

- [ ] **Step 2: `restore.service.ts`**
  - Add `'payment_proofs'` to `KNOWN_TABLES`.
  - Add `const PROOF_STATUSES = new Set(['pending', 'approved', 'rejected']);` next to the other enum sets.
  - Add `paymentProof: p.paymentProof ?? {},` to `models()`.
  - Insert this module directly AFTER the `payments` block (line ~345):

```ts
  for (const r of tables.payment_proofs ?? []) {
    try {
      const id = str(r.id);
      const transactionId = str(r.transactionId);
      const amount = numOrNull(r.amount);
      const imagePath = str(r.imagePath);
      if (!id || !transactionId || amount === null || !imagePath) throw new Error('missing payment proof fields');
      const parent = await m.transaction.findUnique?.({ where: { id: transactionId } });
      if (!parent) throw new Error('missing transaction');
      const reviewedById = str(r.reviewedById);
      const reviewer = reviewedById ? await m.profile.findUnique?.({ where: { id: reviewedById } }) : null;
      const status = str(r.status);
      const data: Row = {
        transactionId,
        amount,
        reference: strOrNull(r.reference),
        channel: strOrNull(r.channel),
        imagePath,
        status: status && PROOF_STATUSES.has(status) ? status : 'pending',
        rejectionReason: strOrNull(r.rejectionReason),
        reviewedById: reviewer ? reviewedById : null,
        reviewedAt: dateOrNull(r.reviewedAt),
        createdAt: dateOrNow(r.createdAt),
      };
      await upsertById(m.paymentProof, id, data, { ...data, createdAt: undefined });
      bump(restored, 'payment_proofs');
    } catch {
      bump(skipped, 'payment_proofs');
    }
  }
```

- [ ] **Step 3: Tests** — extend `backend/tests/backup.test.ts` with:
  1. A full backup payload (profiles → inventory_items → transactions → payment_proofs) restores the proof row and `summary.restored.payment_proofs === 1`.
  2. A proof whose `transactionId` has no parent is skipped (`summary.skipped.payment_proofs === 1`).

- [ ] **Step 4: Run** — `npx vitest run tests/backup.test.ts && npx tsc --noEmit && npx vitest run`

- [ ] **Step 5: Commit**

```
git add backend/src/services/backup.service.ts backend/src/services/restore.service.ts backend/tests/backup.test.ts
git commit -m "feat(backups): include payment_proofs in backup/restore"
```

---

## Task 7: Frontend services, demo mode, notification types

**Files:**
- Modify: `frontend/src/services/payments.js`
- Modify: `frontend/src/utils/demoInterceptor.js`
- Modify: `frontend/src/components/NotificationsDropdown.jsx`

- [ ] **Step 1: `services/payments.js`** — add (matching the file's existing style):

```js
export const submitProof = (bookingId, payload) => api.post(`/bookings/${bookingId}/payment-proof`, payload);
export const listProofs = (limit) => api.get(`/payments/proofs${limit ? `?limit=${limit}` : ''}`);
export const approveProof = (proofId, amount) => api.post(`/payments/proofs/${proofId}/approve`, amount != null ? { amount } : {});
export const rejectProof = (proofId, reason) => api.post(`/payments/proofs/${proofId}/reject`, { reason });
```

(Mirror the file's actual export style — some functions are on `paymentsService`; follow what is already there.)

- [ ] **Step 2: Demo mode** in `utils/demoInterceptor.js`:
  - `/settings/rental-defaults` response gains `manual_qr_codes: [{ id: 'demo-qr-1', label: 'GCash', accountName: 'Mylene S.', imagePath: '' }]` and `store_contact`.
  - `POST /bookings/:id/payment-proof` → pushes an in-memory proof `{ id, status: 'pending', amount, reference, channel, createdAt }` onto the booking and the queue store; returns `{ proof }`.
  - `GET /payments/proofs` → `{ pending: [one seeded proof], awaiting: [one manual unpaid booking without pending], counts }`.
  - `POST /payments/proofs/:id/approve` → flips the in-memory proof to `approved` and credits the mock transaction (`totalPaid`/`balance`), returns `{ proof, totalPaid, balance }`.
  - `POST /payments/proofs/:id/reject` → flips to `rejected` with the reason, returns `{ proof }`.
  - `create-intent` when the demo gateway is manual → `{ gateway: 'manual', amount, qrCodes, simulated: false }`.

- [ ] **Step 3: `NotificationsDropdown.jsx`**
  - `TYPE_CONFIG` gains three entries following the file's shape, lucide icons, app colors:
    - `payment_proof` → `ClipboardCheck`, amber
    - `payment_proof_approved` → `ShieldCheck`, emerald
    - `payment_proof_rejected` → `ShieldAlert`, red
  - `targetTabForNotification`: staff `payment_proof` → `'Tasks'`; the customer proof results fall through to the existing History default (verify the default, don't add a redundant case).

- [ ] **Step 4: Verify** — `npm run build` in `frontend/`, then `npm run demo -- --port 5199 --strictPort` and manually confirm: Admin → Settings → Integrations still loads; switching demo roles works; no console errors.

- [ ] **Step 5: Commit**

```
git add frontend/src/services/payments.js frontend/src/utils/demoInterceptor.js frontend/src/components/NotificationsDropdown.jsx
git commit -m "feat(ui): proof services, demo routes, notification types for manual QR"
```

---

## Task 8: Customer booking flow — ManualQrPayment + CustomerRentalFlow

**Files:**
- Create: `frontend/src/components/ManualQrPayment.jsx`
- Modify: `frontend/src/components/CustomerRentalFlow.jsx`

- [ ] **Step 1: Create `ManualQrPayment.jsx`** (controlled component — parent owns `channel`/`reference`/`file` so the submit sequence can read them):

```jsx
import { useEffect, useState } from 'react';
import { ScanLine, X, Upload } from 'lucide-react';
import { publicUrlFor } from '../utils/images';

// Shared customer-facing QR panel (booking flow step 2 + My Rentals resume).
export default function ManualQrPayment({
  qrCodes = [],
  channel, onChannelChange,
  reference, onReferenceChange,
  file, onFileChange,
  disabled = false,
  storeContact = '',
}) {
  const [lightbox, setLightbox] = useState(null);
  const [preview, setPreview] = useState(null);
  const selected = qrCodes.find((q) => q.id === channel) || qrCodes[0] || null;

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (qrCodes.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
        <ScanLine size={28} className="mx-auto text-amber-500" />
        <p className="mt-2 text-sm font-bold text-gray-900">Payment QR not yet set up</p>
        <p className="mt-1 text-xs text-gray-600">
          Please contact the boutique{storeContact ? ` at ${storeContact}` : ''} to complete your downpayment.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {qrCodes.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {qrCodes.map((qr) => (
            <button key={qr.id} type="button" disabled={disabled} onClick={() => onChannelChange(qr.id)}
              className={`shrink-0 px-4 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                selected?.id === qr.id
                  ? 'border-[#bf4a53] bg-red-50 text-[#bf4a53]'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}>
              {qr.label}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center">
          <button type="button" onClick={() => setLightbox(selected)} disabled={disabled}
            className="block mx-auto w-44 h-44 rounded-xl border border-gray-100 overflow-hidden bg-gray-50">
            <img src={publicUrlFor(selected.imagePath)} alt={`${selected.label} QR code`} className="w-full h-full object-contain" />
          </button>
          <p className="mt-3 text-sm font-bold text-gray-900">{selected.label}</p>
          {selected.accountName && <p className="text-xs text-gray-500">{selected.accountName}</p>}
          <button type="button" onClick={() => setLightbox(selected)} disabled={disabled}
            className="mt-2 text-xs font-semibold text-[#bf4a53] hover:underline">
            Open full-size QR ↗
          </button>
          <p className="mt-2 text-[11px] text-gray-400 leading-snug">
            Scan or save this QR, then verify the recipient in your payment app before sending.
          </p>
        </div>
      )}

      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
          Transaction or reference number <span className="font-medium normal-case">(optional)</span>
        </label>
        <input type="text" value={reference} maxLength={40} disabled={disabled}
          onChange={(e) => onReferenceChange(e.target.value)}
          placeholder="e.g. 000123456789"
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 placeholder-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors" />
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Payment screenshot</label>
        {file ? (
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-2xl p-3">
            <img src={preview} alt="Payment screenshot preview" className="w-14 h-14 rounded-xl object-cover border border-gray-100" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{file.name}</p>
              <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button type="button" onClick={() => onFileChange(null)} disabled={disabled} aria-label="Remove screenshot"
              className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <X size={16} />
            </button>
          </div>
        ) : (
          <label className={`flex items-center justify-center gap-2 w-full py-4 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${
            disabled ? 'border-gray-200 text-gray-300' : 'border-gray-300 text-gray-500 hover:border-[#bf4a53] hover:text-[#bf4a53]'
          }`}>
            <Upload size={16} />
            <span className="text-sm font-semibold">Upload screenshot (PNG, JPG, WebP — max 5 MB)</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={disabled}
              onChange={(e) => onFileChange(e.target.files?.[0] || null)} />
          </label>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-900">{lightbox.label}</p>
              <button type="button" onClick={() => setLightbox(null)} aria-label="Close QR"
                className="p-2 rounded-xl text-gray-400 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <img src={publicUrlFor(lightbox.imagePath)} alt={`${lightbox.label} QR code full size`}
              className="w-full rounded-2xl border border-gray-100" />
            {lightbox.accountName && <p className="mt-2 text-center text-xs text-gray-500">{lightbox.accountName}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: no `alt` text on QR is a scanning aid only — real screen-reader users get the label text; fine.

- [ ] **Step 2: Wire `CustomerRentalFlow.jsx`**

1. Imports: `import ManualQrPayment from './ManualQrPayment';` — plus add `downscaleToJpeg` from `../utils/file` and the new `submitProof` to the existing `../services/payments` import (line 27 block).
2. Line 117 initial `rentalDefaults`: add `manual_qr_codes: []`, `store_contact: ''`.
3. Line ~127 fetch mapping:
```js
payment_gateway: d.payment_gateway === 'maya' ? 'maya' : d.payment_gateway === 'manual' ? 'manual' : 'paymongo',
manual_qr_codes: Array.isArray(d.manual_qr_codes) ? d.manual_qr_codes : [],
store_contact: d.store_contact || '',
```
4. After line 175: `const isManualGateway = rentalDefaults.payment_gateway === 'manual';`
5. New state near the payment state: `proofChannel`, `proofReference`, `proofFile`, `manualTx` (booking created but proof upload failed). Default the channel when QRs load:
```js
useEffect(() => {
  if (!proofChannel && rentalDefaults.manual_qr_codes.length > 0) {
    setProofChannel(rentalDefaults.manual_qr_codes[0].id);
  }
}, [rentalDefaults.manual_qr_codes]);
```
6. `buildBookingData` (line 453): add `paymentPath: isManualGateway ? 'manual' : undefined,`
7. `handleNextInner` step 2 — insert the manual branch at the top of the existing `if (step === 2) {` body (before the PayMongo `createIntent` code):
```js
      if (isManualGateway) {
        if (rentalDefaults.manual_qr_codes.length === 0) {
          setConfirmError('Payment QR not yet set up — please contact the boutique.');
          return;
        }
        if (!proofFile) {
          setConfirmError('Please upload your payment screenshot before submitting.');
          return;
        }
        if (proofFile.size > 5 * 1024 * 1024) {
          setConfirmError('Screenshot must be 5 MB or smaller.');
          return;
        }
        // The booking is created ONCE; retries only re-upload the proof.
        const created = manualTx || (await onSubmitBooking(buildBookingData()));
        if (!manualTx) setManualTx(created);
        try {
          const data = await downscaleToJpeg(proofFile, 1280, 0.85);
          if (!data) throw new Error('Could not read that image — try another screenshot.');
          await submitProof(created.id, {
            data,
            contentType: 'image/jpeg',
            reference: proofReference.trim() || undefined,
            channel: proofChannel || undefined,
          });
        } catch (proofErr) {
          // Booking stays (no rollback like the gateway path) — the customer
          // retries here or resumes from My Rentals.
          setConfirmError(proofErr?.message || 'Your booking is saved — upload your payment proof to continue.');
          return;
        }
        setManualTx(null);
        setConfirmedTx(created);
        setPaymentSuccess(true);
        setTimeout(() => { setPaymentSuccess(false); setStep(3); }, 1500);
        return;
      }
```
8. Step 2 UI (line 1083): change `{isMayaGateway ? (` to `{isManualGateway ? (\n  <ManualQrPayment qrCodes={rentalDefaults.manual_qr_codes} channel={proofChannel} onChannelChange={setProofChannel} reference={proofReference} onReferenceChange={setProofReference} file={proofFile} onFileChange={setProofFile} disabled={isProcessingPayment} storeContact={rentalDefaults.store_contact} />\n) : isMayaGateway ? (` and close the new ternary correctly.
9. Success overlay (line 813-814): conditional copy —
```jsx
<p className="font-bold text-gray-900 text-xl">{isManualGateway ? 'Submitted for review!' : 'Payment Confirmed!'}</p>
<p className="text-sm text-gray-500">{isManualGateway ? 'Sending you to your receipt…' : 'Redirecting to your receipt…'}</p>
```
10. Step-3 receipt: after the opening `<div className="space-y-5">` (line 1267) add the amber banner; adjust the "Booking Confirmed!" sub-copy (line 1273) to `{isManualGateway ? 'Your booking is waiting for payment verification.' : 'Your reservation has been secured.'}`; and replace the "Paid now (downpayment)" card (lines 1302-1305) with:
```jsx
<div className={`bg-white border-2 rounded-xl px-3.5 py-3.5 flex justify-between items-center shadow-sm ${isManualGateway ? 'border-amber-200' : 'border-[#bf4a53]'}`}>
  <span className="text-sm font-bold text-gray-900">
    {isManualGateway ? 'Downpayment' : 'Paid now'}{' '}
    <span className="font-medium text-gray-400">({isManualGateway ? 'under review' : 'downpayment'})</span>
  </span>
  <span className={`font-extrabold text-xl tabular-nums ${isManualGateway ? 'text-amber-600' : 'text-[#bf4a53]'}`}>₱{txDownpayment(confirmedTx).toLocaleString()}</span>
</div>
```
Banner code:
```jsx
{isManualGateway && (
  <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left">
    <Clock size={17} className="text-amber-600 shrink-0 mt-0.5" />
    <div className="min-w-0">
      <p className="text-xs font-extrabold text-amber-800">Payment submitted for review</p>
      <p className="text-[11px] text-amber-700 leading-snug mt-0.5">
        We'll confirm your booking once our team verifies your payment screenshot.
      </p>
    </div>
  </div>
)}
```
(add `Clock` to the lucide import at line 2).
11. Footer primary button for step 2 (search the step-2 footer for the confirm label, e.g. "Confirm Payment"): label becomes `isManualGateway ? 'Submit booking for review' : <existing label>`.
12. Also `buttonsDisabled`/`isProcessingPayment` handling unchanged.

- [ ] **Step 3: Verify** — `npm run build` in `frontend/`. Then demo-run the flow: `npm run demo -- --port 5199 --strictPort`, role Customer, book an item with the demo gateway switched to manual (temporarily set the demo `/settings/rental-defaults` to `'manual'` to exercise the branch — the demo fixture defaults to whatever you set; leave it `'manual'` for the demo walkthrough since the whole feature is demo-able).

- [ ] **Step 4: Commit**

```
git add frontend/src/components/ManualQrPayment.jsx frontend/src/components/CustomerRentalFlow.jsx
git commit -m "feat(ui): manual QR payment step in customer booking flow"
```

---

## Task 9: My Rentals resume — badges + PaymentProofModal

**Files:**
- Create: `frontend/src/components/PaymentProofModal.jsx`
- Modify: `frontend/src/pages/DashboardView.jsx` (Your Rentals rows, lines 282-293)

**Interfaces:**
- `<PaymentProofModal tx={tx} onClose={} onSubmitted={} />` — fetches `rental-defaults` itself, reuses `ManualQrPayment`, submits via `submitProof(tx.id, …)`.

- [ ] **Step 1: Create `PaymentProofModal.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { X, Loader2, Clock } from 'lucide-react';
import ManualQrPayment from './ManualQrPayment';
import { api } from '../utils/api';
import { downscaleToJpeg } from '../utils/file';
import { submitProof } from '../services/payments';

// Resume an abandoned/rejected manual payment from My Rentals. The booking
// already exists; this only uploads a fresh proof.
export default function PaymentProofModal({ tx, onClose, onSubmitted }) {
  const [qrCodes, setQrCodes] = useState([]);
  const [storeContact, setStoreContact] = useState('');
  const [channel, setChannel] = useState('');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/settings/rental-defaults')
      .then((d) => {
        if (!active) return;
        const codes = Array.isArray(d?.manual_qr_codes) ? d.manual_qr_codes : [];
        setQrCodes(codes);
        setStoreContact(d?.store_contact || '');
        if (codes[0]) setChannel(codes[0].id);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const handleSubmit = async () => {
    if (!file) { setError('Please upload your payment screenshot.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Screenshot must be 5 MB or smaller.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const data = await downscaleToJpeg(file, 1280, 0.85);
      if (!data) throw new Error('Could not read that image — try another screenshot.');
      await submitProof(tx.id, {
        data, contentType: 'image/jpeg',
        reference: reference.trim() || undefined,
        channel: channel || undefined,
      });
      onSubmitted?.();
      onClose();
    } catch (err) {
      setError(err?.message || 'Upload failed — please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100/80">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Upload payment proof</h2>
            <p className="text-xs text-gray-500 mt-0.5">Booking #{(tx.txNumber ?? '')} — under review until verified.</p>
          </div>
          <button onClick={onClose} aria-label="Close payment proof" className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <ManualQrPayment
            qrCodes={qrCodes}
            channel={channel} onChannelChange={setChannel}
            reference={reference} onReferenceChange={setReference}
            file={file} onFileChange={setFile}
            disabled={submitting}
            storeContact={storeContact}
          />
          {error && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <Clock size={15} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-red-700">{error}</p>
            </div>
          )}
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-3.5 rounded-2xl bg-[#bf4a53] text-white text-sm font-bold shadow-sm hover:bg-[#a83f47] disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
            {submitting ? (<><Loader2 size={16} className="animate-spin" /> Submitting…</>) : 'Submit for review'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `DashboardView.jsx` Your Rentals rows** (lines 282-293)

For each `tx` compute:
```js
const proof = Array.isArray(tx.paymentProofs) ? tx.paymentProofs[0] : null;
const unpaidManual = !proof || proof.status === 'rejected';
const canResume = unpaidManual && (tx.paymentPath === 'manual' || tx.gateway === 'manual' || (!tx.gateway && tx.totalPaid < (tx.downpayment || 0)));
```
Row changes:
- When `proof?.status === 'pending'`: amber badge `Payment under review`.
- When `proof?.status === 'rejected'`: red badge `Payment not verified` + (second line) `text-[11px] text-red-500 truncate` reason.
- When `canResume` and no proof: gray badge `Unpaid` plus an `Upload payment proof` action button (`text-xs font-semibold text-[#bf4a53] hover:underline`, per existing "View All" link style) that sets `proofModalTx(tx)` state.
- Badges reuse the existing `txPill`-style pattern (`text-[10px] font-bold px-2 py-0.5 rounded-full` + bg/text classes — do not use `txPill(tx.status)` for these; use explicit amber/red/gray classes).
- Render `{proofModalTx && <PaymentProofModal tx={proofModalTx} onClose={() => setProofModalTx(null)} onSubmitted={refreshBookings} />}` at the end of the customer return block. `refreshBookings` = whatever callback re-fetches the customer's transactions on this screen (find how `transactions` are loaded for the customer and reuse it; if none exists, call the same fetch the page already uses for Home data).

- [ ] **Step 3: Verify** — `npm run build`; demo-run: Customer role → Home → seed a rejected/awaiting booking in the demo fixture → "Upload payment proof" opens the modal → submit flips the row to "Payment under review".

- [ ] **Step 4: Commit**

```
git add frontend/src/components/PaymentProofModal.jsx frontend/src/pages/DashboardView.jsx
git commit -m "feat(ui): My Rentals payment-proof resume with badges"
```

---

## Task 10: Staff Tasks — Payments to verify queue + review modal

**Files:**
- Create: `frontend/src/hooks/usePaymentProofs.js`
- Create: `frontend/src/components/PaymentProofsQueue.jsx`
- Create: `frontend/src/components/PaymentProofReviewModal.jsx`
- Modify: `frontend/src/pages/StaffTasksView.jsx`

- [ ] **Step 1: `hooks/usePaymentProofs.js`** — mirror the cache/poll discipline of `useDashboard.js` (same Map+timestamp approach, 45s poll):

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { listProofs } from '../services/payments';

const POLL_MS = 45_000;
const cache = new Map();

export function usePaymentProofs(enabled) {
  const key = 'payment-proofs:queue';
  const [data, setData] = useState(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(!cache.has(key));
  const fetchedAt = useRef(cache.get(`${key}:at`) ?? 0);

  const refresh = useCallback(async () => {
    try {
      const fresh = await listProofs();
      cache.set(key, fresh);
      cache.set(`${key}:at`, Date.now());
      fetchedAt.current = Date.now();
      setData(fresh);
    } catch {
      // keep last good data; the poll retries
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!cache.has(key) || Date.now() - fetchedAt.current > POLL_MS) refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  return { data, loading, refresh };
}
```

- [ ] **Step 2: `PaymentProofsQueue.jsx`** — card styled exactly like existing Tasks sections (`bg-white rounded-3xl border border-gray-100/50 shadow-sm`, icon tile `w-10 h-10 rounded-2xl bg-[#bf4a53]/10 text-[#bf4a53]`, title + count badge). Contents:
  - Header: `ClipboardCheck` icon, "Payments to verify", amber count badge for `counts.pending + counts.awaiting`.
  - Tabs: **Pending** / **Awaiting proof** (pill tabs like the app's filter chips; active = `bg-[#bf4a53] text-white`).
  - Pending rows: customer name, `#txNumber`, claimed amount, reference/channel, `timeAgo`, screenshot thumbnail via `<ItemImage src={p.imagePath} thumb className="w-12 h-12 rounded-xl" />` (handles private-path signing); click → `onReview(proof)`.
  - Awaiting rows: customer, item, downpayment, `latestProof?.rejectionReason` (red microcopy) when present; no click action (staff chase/cancel via existing flows).
  - Loading → 3 skeleton rows (existing `animate-pulse bg-gray-100 rounded-2xl h-16` convention); empty → "All clear" copy with a check icon, per tab.
  - Return `null` when `!loading && counts.pending + counts.awaiting === 0`? No — spec keeps it visible at the top of Tasks; render with the empty state instead.

- [ ] **Step 3: `PaymentProofReviewModal.jsx`** — mirror `ReleaseItemModal`'s bottom-sheet structure (drag handle on mobile, `sm:max-w-lg sm:rounded-3xl`, `aria-label`ed close). Contents:
  - Full screenshot: `<ItemImage src={proof.imagePath} className="w-full rounded-2xl border border-gray-100" />` — tap toggles a zoom overlay (fixed inset black/80, img object-contain).
  - Booking summary: item name, booking `#txNumber`, pickup/due dates, customer name + phone (tap-to-call `tel:` link per app convention) + address.
  - Claimed amount / reference / channel rows.
  - Approve: number input prefilled with the claimed amount (`text-sm font-bold`, brand focus ring — same as the downpayment input). Inline amber warning when the parsed value ≠ claim or < `transaction.downpayment`. Confirm button `bg-[#bf4a53]`.
  - Reject: textarea (required, 5–300) + red confirm button.
  - Submitting state disables both; server errors surface verbatim in a red banner; success → toast + `onDone()` (queue refresh + close).

- [ ] **Step 4: `StaffTasksView.jsx`** — mount above the "Ready for Pickup" section:
```jsx
<PaymentProofsQueue role={role} />
```
(component owns the hook; it accepts `role` only to decide `enabled = role === 'Staff' || role === 'Admin'` — Tasks is staff/admin-only anyway.)

- [ ] **Step 5: Verify** — `npm run build`; demo-run staff role: seeded pending proof renders, review modal approves it (fixture flips), queue empties; reject path shows the reason on the awaiting tab.

- [ ] **Step 6: Commit**

```
git add frontend/src/hooks/usePaymentProofs.js frontend/src/components/PaymentProofsQueue.jsx frontend/src/components/PaymentProofReviewModal.jsx frontend/src/pages/StaffTasksView.jsx
git commit -m "feat(ui): staff Payments to verify queue + review modal"
```

---

## Task 11: Counter collection — ManualQrPanel in the three collect surfaces

**Files:**
- Create: `frontend/src/components/ManualQrPanel.jsx` (presentational — QR chips + card + account, no submit logic)
- Modify: `frontend/src/components/ReleaseItemModal.jsx`
- Modify: `frontend/src/components/TransactionDetailModal.jsx`
- Modify: `frontend/src/pages/StaffNewRental.jsx`

**Behavior in all three (spec §7.2):** when `gateway === 'manual'`, the "Online" collection branch shows the QR panel + a button **"Customer has paid — record payment"** which calls the SAME record path that surface already uses for cash, with `method: 'instapay'` and the channel label in `notes`. No proof row; the staff member is the reviewer.

- [ ] **Step 1: Create `ManualQrPanel.jsx`** — reuse the QR card markup from `ManualQrPayment` but display-only (no file/reference inputs), plus a `channel`/`onChannelChange` pair via chips when >1 QR. Fetch nothing: accept `qrCodes` + optional `note` as props. Copy: label, accountName, "Scan or save this QR, then verify the recipient in your payment app before sending."

- [ ] **Step 2: `ReleaseItemModal.jsx`**
  - Its gateway state comes from `/settings/rental-defaults` (search `payment_gateway`); extend the mapping to `'manual'` and store `manual_qr_codes`.
  - In the "Online" branch, when manual: render `<ManualQrPanel qrCodes={…} />` instead of the Maya/PayMongo UI, plus the confirm button. The button calls the modal's existing cash-record call (`POST /transactions/:id/payments`) with `{ amount: <full outstanding>, method: 'instapay', notes: `${channelLabel} transfer — verified in person` }`, then merges the response totals into local `tx` exactly as the cash path does. Release stays gated on ₱0 outstanding (unchanged).

- [ ] **Step 3: `TransactionDetailModal.jsx`**
  - `gateway` state mapping (line ~135) gains `manual` + store `manual_qr_codes`.
  - In the Record Payment modal's "Online" tab (lines ~887-980), when `gateway === 'manual'`: instead of `createIntent`, render `<ManualQrPanel />` + "Customer has paid — record payment" → existing record path with `method:'instapay'` + notes. Keep the cash tab untouched.

- [ ] **Step 4: `StaffNewRental.jsx`**
  - `gateway` state (line ~71-77) gains `manual` + `manual_qr_codes`.
  - The "Online" collection branch (lines ~1211-1245): when manual, render `<ManualQrPanel />` and a confirm button that records the downpayment via the existing record call (`method: 'instapay'`), then proceeds to finish exactly as the webhook-confirmed path does (merge totals → receipt). No polling.

- [ ] **Step 5: Verify** — `npm run build`; demo-run staff: open a booking on Tasks, Record Payment → Online → QR panel renders; on a fresh staff booking with manual gateway the collection step shows the QR.

- [ ] **Step 6: Commit**

```
git add frontend/src/components/ManualQrPanel.jsx frontend/src/components/ReleaseItemModal.jsx frontend/src/components/TransactionDetailModal.jsx frontend/src/pages/StaffNewRental.jsx
git commit -m "feat(ui): counter QR panel + instapay record on collect surfaces"
```

---

## Task 12: Admin Settings — gateway option + Payment QR manager

**Files:**
- Create: `frontend/src/components/settings/PaymentQrManager.jsx`
- Modify: `frontend/src/components/settings/IntegrationsTab.jsx` (gateway selector ~149-211, extra card slot ~297-303)

- [ ] **Step 1: Gateway selector** — add the third option `value: 'manual'`, label **"Manual QR (InstaPay / bank app)"**, helper text: "Customers pay by scanning your QR and uploading a screenshot for staff review." Existing save/reset + toast logic stays; the selector already writes `payment_gateway` through the rules save path.

- [ ] **Step 2: `PaymentQrManager.jsx`**
  - Props: `{ value, onChange }` where `value` is the parsed list (the settings shell already loads rules; if IntegrationsTab doesn't carry `manual_qr_codes`, load it from `GET /settings/rules` in the manager on mount and PUT on save through the same rules-save call IntegrationsTab uses).
  - List rows: `<ItemImage src={qr.imagePath} thumb />` preview, label, account name, Edit (inline label/account inputs), Delete (confirm).
  - Add: upload flow reusing the admin storage upload used elsewhere in Settings (base64 via `fileToBase64`/`downscaleToJpeg` from `utils/file.js`, path `qrcodes/<slug>-<ts>.jpg`), then label + accountName inputs.
  - Persist: `manual_qr_codes: JSON.stringify(list)` through the settings rules save (admin + MFA already enforced server-side). Errors from the server surface verbatim (400 on invalid paths).
  - Card chrome: `SettingsCard` primitive + title "Payment QR codes" (eyebrow label style).

- [ ] **Step 3: Verify** — `npm run build`; demo-run admin: Settings → Integrations → select Manual QR (toast + helper visible), manager card adds/removes a (demo) QR.

- [ ] **Step 4: Commit**

```
git add frontend/src/components/settings/PaymentQrManager.jsx frontend/src/components/settings/IntegrationsTab.jsx
git commit -m "feat(settings): admin manual QR gateway + QR manager"
```

---

## Task 13: Final verification

- [ ] **Step 1: Backend** — from `backend/`:

```powershell
npx tsc --noEmit
npx vitest run
```

Expected: clean; all tests pass (previous count + the new `manualQr.test.ts` cases).

- [ ] **Step 2: Frontend** — from `frontend/`:

```powershell
npm run build
```

Expected: exit 0.

- [ ] **Step 3: Demo walkthrough** — `npm run demo -- --port 5199 --strictPort`, and in each role:
  - Customer: book with manual gateway → QR panel → reference + screenshot → submit → amber receipt (never says "Paid"); Home shows "Payment under review".
  - Staff: Tasks → Payments to verify → approve → toast; booking totals move; customer gets a notification; reject flow shows reason on awaiting tab.
  - Admin: Integrations shows the Manual QR option + QR manager; notifications dropdown shows the new types with correct colors.
  - Reload between steps; zero console errors.

- [ ] **Step 4: Live-DB drift check** (after any push):

```powershell
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: exit 0.

- [ ] **Step 5: Final commit** (if any fixes landed) and hand off — update `AGENTS.md` Work State with a summary line for the feature.
