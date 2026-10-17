# PRD: Manual QR Payment (Static InstaPay / Bank QR + Proof Review)

**Project:** RENTECH — Mylene's Boutique Rental Management System
**Date:** 2026-10-17
**Status:** Draft — awaiting spec review
**Branch:** `feat/payment-gateway-and-sms-integration`
**Extends:** the gateway layer from the Maya QRPh spec (`2026-09-30-maya-qrph-gateway-design.md`) with a third, staff-verified gateway

---

## 1. Problem Statement

Customers must pay a downpayment to secure a booking. The two live paths — PayMongo
(hosted Drop-In) and Maya QRPh — both require a fully provisioned merchant account.
When neither is available (or their quotas/onboarding stall), the boutique has no way
to accept online downpayments inside RENTECH: staff fall back to screenshots over
Messenger and manual bookkeeping, and the platform's ledger never sees the money.

This feature adds a **third gateway: Manual QR**. The boutique uploads one or more
static QR codes (InstaPay / GCash / any bank app). The customer scans the chosen QR,
pays from their banking app, uploads a screenshot with an optional reference number,
and the booking is submitted **for staff review**. Staff approve (the downpayment is
credited through the existing idempotent ledger) or reject with a reason (the customer
is notified and may resubmit against the same booking).

### 1.1 Goals

| # | Goal | Success measure |
|---|------|-----------------|
| G1 | Customers can secure a booking with a manual QR without any merchant gateway | Booking + proof submitted; staff queue shows it; approval credits `totalPaid` |
| G2 | Money is never claimed before verification | Customer UI says "submitted for review", never "paid", until staff approve |
| G3 | Approval cannot double-credit | `gatewayRef = 'proof_<id>'` reuses the ledger's unique constraint |
| G4 | Counter collection keeps working when the gateway is Manual | Staff show the same QR at pickup; recording uses the existing `recordPayment` path |
| G5 | Rejected customers recover without re-booking | Resubmission allowed while the booking is unpaid; staff can still cancel manually |
| G6 | Existing gateways are untouched | PayMongo/Maya tests stay green unchanged; flipping the rule back is a no-op |

### 1.2 Non-goals

- **Customer self-serve balance payment online** — the manual QR covers the booking
  downpayment and counter collection (staff-verified). Paying a remaining balance from
  home via proof upload is a future extension.
- **Partial/multiple online proofs per payment** — one live proof per booking at a time
  (`pending` blocks resubmission); staff may correct the credited amount at approval.
- **Email notifications for proof events** — in-app notifications only (the existing
  order emails around booking/release/return still fire unchanged).
- **QR code generation from bank account details** — the boutique uploads images of
  QR codes their banking app already produced.

---

## 2. Decisions (from brainstorming, approved)

| # | Decision | Choice |
|---|----------|--------|
| D1 | How Manual fits the gateway system | Third `payment_gateway` value (`'manual'`), admin-selected in Settings → Integrations — replaces the charge flow for every customer booking, exactly like switching to Maya |
| D2 | QR source | **Multiple labeled QRs** uploaded by the admin (label + account name + image). Customer picks the channel they'll use |
| D3 | Review ownership & location | **Staff Tasks** gains a "Payments to verify" queue; Staff **and** Admin can approve/reject |
| D4 | Scope beyond booking | **Booking downpayment + counter pickup** (staff-verified in person, no proof upload at the counter) |
| D5 | Rejected proof | Booking stays; customer notified with the reason and **can resubmit**; staff can cancel manually if needed |
| D6 | Data model (approach A) | New `PaymentProof` table + QR list as a `manual_qr_codes` BusinessRule (JSON); approval reuses `applyPaymentToTransaction` |
| D7 | UI requirement (explicit) | Every new surface must match the app's existing style/theme (Section 10) |

---

## 3. Architecture

```
                     ┌──────────────────────────────────────┐
   BusinessRule      │ payment_gateway                      │
   payment_gateway   │ 'paymongo' | 'maya' | 'manual'       │
   manual_qr_codes   │ [{id,label,accountName,imagePath}]   │
                     └──────────────┬───────────────────────┘
                                    │
      ┌─────────────────────────────┼──────────────────────────────┐
      │                             │                              │
┌─────▼──────────────┐   ┌──────────▼───────────┐   ┌──────────────▼─────────────┐
│ Customer booking   │   │ Counter collection   │   │ Staff review               │
│ CustomerRentalFlow │   │ ReleaseItemModal +   │   │ StaffTasksView queue →     │
│ → booking (manual) │   │ TransactionDetail +  │   │ approve / reject →         │
│ → POST proof       │   │ StaffNewRental       │   │ notifications + audit      │
└─────┬──────────────┘   │ → recordPayment      │   └──────────────┬─────────────┘
      │                  │   (method instapay)  │                  │
      │                  └──────────────────────┘                  │
      │                                                            │
      ▼                                                            ▼
┌──────────────────────────┐                    ┌─────────────────────────────────┐
│ POST /bookings/:id/      │                    │ POST /payments/proofs/:id/      │
│      payment-proof       │                    │      approve | reject           │
│  (customer, rate-limited)│                    │ (Staff/Admin, audited)          │
│  uploads → private bucket│                    └─────────────┬───────────────────┘
│  inserts PaymentProof    │                                  │
└──────────────────────────┘                                  ▼
                                    ┌───────────────────────────────────────────┐
                                    │ payments.ledger.ts                        │
                                    │ applyPaymentToTransaction({               │
                                    │   gateway: 'manual',                      │
                                    │   gatewayRef: 'proof_<proofId>' })        │
                                    │ — idempotent by unique constraint         │
                                    └───────────────────────────────────────────┘
```

**Money rule:** the customer's claimed amount is metadata. The credited amount is
`proof.amount` (server-derived at submission: the booking's recorded downpayment),
optionally corrected by staff at approval, always clamped to the outstanding balance by
the ledger. The one crediting path remains `payments.ledger.ts` — no new money math.

**Trust rule:** a proof can never mark a booking paid by itself. Only a Staff/Admin
approval moves money, and it is audit-logged with the reviewer's identity.

---

## 4. Data Model

### 4.1 New table `PaymentProof` (additive)

```prisma
model PaymentProof {
  id              String    @id @default(uuid())
  transactionId   String    @map("transaction_id")
  amount          Float     // server-set: the booking's recorded downpayment
  reference       String?   // customer-entered bank/e-wallet ref (≤40 chars)
  channel         String?   // label of the QR the customer used
  imagePath       String    @map("image_path")   // rental/<txId>/proof-<ts>.webp
  status          String    @default("pending")  // pending | approved | rejected
  rejectionReason String?   @map("rejection_reason")
  reviewedById    String?   @map("reviewed_by_id")
  reviewedAt      DateTime? @map("reviewed_at")
  createdAt       DateTime  @default(now()) @map("created_at")

  transaction Transaction @relation(fields: [transactionId], references: [id])
  reviewedBy  Profile?    @relation("ReviewedPaymentProofs", fields: [reviewedById], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@index([transactionId])
  @@index([reviewedById])
  @@map("payment_proofs")
}
```

Relation back-refs: `Transaction.paymentProofs PaymentProof[]`,
`Profile.reviewedPaymentProofs PaymentProof[] @relation("ReviewedPaymentProofs")`.

### 4.2 `Transaction.paymentPath`

```prisma
paymentPath String? @map("payment_path")   // 'manual' | null — set at booking creation
```

Used to identify **abandoned manual bookings** (customer closed the browser before
uploading proof) for the queue's "Awaiting proof" tab. Set by `createRental` when the
customer booking call passes `paymentPath: 'manual'` (new optional field on
`createBookingSchema`). Purely operational metadata — it gates no money decisions.

### 4.3 BusinessRule `manual_qr_codes`

JSON string held in the existing `business_rules.value` column:

```json
[
  { "id": "<uuid>", "label": "GCash", "accountName": "Mylene S.", "imagePath": "qrcodes/gcash-1730....webp" }
]
```

- **Validated server-side** when written through `PUT /settings/rules`: parseable JSON,
  array ≤ 10 entries, `label` 1–40 chars, `accountName` ≤ 60 chars, `imagePath` must
  match the storage key rules and start with `qrcodes/`. Invalid payload → 400.
- **Exposed publicly** (parsed, empty array on parse failure) via
  `GET /settings/rental-defaults` as `manual_qr_codes` — the booking form renders the
  QR the customer scans, so it must be reachable pre-payment like `payment_gateway` is.
- Images are stored in the **public catalog bucket** (`qrcodes/…`), resolved by the
  frontend's existing zero-round-trip public-URL helper — QR codes are meant to be
  scanned and displayed.
- Deleting an entry removes it from the rule; the storage object is left behind
  (harmless, small) — object cleanup is an ops action, matching catalog conventions.

### 4.4 Existing plumbing extensions (additive only)

| Where | Change |
|-------|--------|
| `payments.ledger.ts` | `gateway` union gains `'manual'`; `method` union gains `'instapay'` |
| `settings.service.ts` `getPaymentGateway()` | returns `'manual'` when the rule says so; unknown still falls back to `'paymongo'` |
| `settings.service.ts` `getRentalDefaults()` | adds parsed `manual_qr_codes`; its `payment_gateway` normalization passes `'manual'` through (currently collapses everything ≠ maya to paymongo) |
| `transactions.service.ts` `recordPayment()` | `validMethods` gains `'instapay'` (counter QR collection) |
| `backup.service.ts` | export includes the new `payment_proofs` table |
| `restore.service.ts` | `KNOWN_TABLES` + a `paymentProof` restore module (FK remapping like `payment`) |

No retention purge for proofs: they are financial evidence and are retained with their
transactions (unlike notifications/SMS/audit logs).

### 4.5 Migration

Additive: one table + one nullable column. Steps (per AGENTS.md DDL discipline):

1. Verify drift: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` (expect 0).
2. `npx prisma db push --skip-generate` (routes DDL through `DIRECT_URL`).
3. Stop backend → `npx prisma generate` → restart (EPERM otherwise).
4. If direct DDL is unavailable (IPv6-only direct host), fall back to targeted
   `prisma db execute` SQL — same pattern used for the reminder-email once-guard columns.
5. Never re-add `db push` to the Render build command.

---

## 5. Backend API

All endpoints are additive. Route ordering note: in `payments.routes.ts` the
`/proofs` routes **must be declared before `GET /:id`** or Express will swallow them.

### 5.1 `POST /api/bookings/:id/payment-proof` — customer submits proof

- **Auth:** `bookingRouter` (already customer-only + auth).
- **Body (zod):** `{ data: string(base64), contentType: 'image/jpeg'|'image/jpg'|'image/png'|'image/webp', reference?: string ≤40, channel?: string ≤40 }`.
  Decoded buffer capped at **5 MB** before the upload call (the storage layer's own cap
  stays 20 MB for other uploads).
- **Guards (in order):**
  1. Booking exists and `customerId === req.user.id` (else 404/403 — same shape as other customer routes).
  2. `status !== 'Cancelled'` (400).
  3. `downpayment > 0` and `totalPaid < downpayment` — otherwise 400 "already settled".
  4. `gateway` is `null` or `'manual'` — a booking with an active PayMongo/Maya charge
     cannot receive a proof (prevents mixing verification paths).
  5. No existing proof with `status='pending'` for the booking (409 — "already under review").
- **Effect:** uploads to `rental/<txId>/proof-<Date.now()>.jpg` via
  `storageService.uploadFile` (auto-rotated, EXIF-stripped, normalized to WebP — the
  stored extension is coerced accordingly), inserts `PaymentProof` with
  `amount = tx.downpayment` (never client-supplied), sets
  `Transaction.paymentPath = 'manual'` (idempotent), then notifies **Staff + Admin**
  directly (`notification.createMany`, type `payment_proof`) — bypassing
  `notifyStaffMembers`' dedupe so a resubmission always re-alerts.
- **Rate limit:** reuse `middleware/rateLimiter.ts` — 10 submissions/hour per user.
- **Response:** the proof summary (id, status, amount, reference, channel, createdAt).

### 5.2 `GET /api/payments/proofs` — staff queue data

- **Auth:** `requireRole(Admin, Staff)`.
- **Query:** `limit` (default 50, max 200).
- **Response:**
  - `pending`: proofs with `status='pending'`, newest first — each joined with
    `{ transaction: { id, txNumber, downpayment, totalPaid, balance }, customer {name, phone}, item {name} }`.
  - `awaiting`: transactions with `paymentPath='manual'`, `totalPaid < downpayment`,
    `status IN (Active, Reserved)`, and **no pending proof** — each with the latest
    proof's status/rejection reason for context (or none).
  - `counts: { pending, awaiting }` for the card badge.

### 5.3 `POST /api/payments/proofs/:id/approve` — staff verifies

- **Auth:** `requireRole(Admin, Staff)`. Audited (`payment_proof.approve`).
- **Body (zod):** `{ amount?: coerce.number().positive() }` — defaults to `proof.amount`;
  staff may correct it to match the screenshot.
- **Guards:** proof exists (404); `status='pending'` (409); tx not `Cancelled` (400,
  mirroring the ledger); `amount ≤ outstanding` (400 — the ledger would clamp silently,
  but staff deserve an explicit error).
- **Effect:** calls `applyPaymentToTransaction({ transactionId, amount, gateway:'manual',
  gatewayRef: 'proof_<proofId>', method: 'instapay' })`. Because `gatewayRef` is
  unique, an approve that lands twice (or a crash-retry) returns `duplicate` and credits
  nothing extra — the endpoint then still reconciles the proof row to `approved` if it
  is still `pending`. Conditional `updateMany` (`where: { id, status: 'pending' }`) sets
  `status='approved'`, `reviewedById`, `reviewedAt` — a racing reject loses cleanly.
  Customer notification (`payment_proof_approved`) + audit log.
- **Response:** `{ proof, totalPaid, balance }` (fresh totals for the UI).

### 5.4 `POST /api/payments/proofs/:id/reject` — staff declines

- **Auth:** `requireRole(Admin, Staff)`. Audited (`payment_proof.reject`).
- **Body (zod):** `{ reason: string 5–300 }` (required).
- **Guards:** proof exists; `status='pending'` (409 otherwise).
- **Effect:** conditional update to `status='rejected'` + reason + reviewer. **No money
  movement; the booking is untouched.** Customer notification (`payment_proof_rejected`,
  message includes the reason and "re-upload from My Rentals"). The customer may submit
  a new proof (the pending guard only blocks a second live submission).

### 5.5 `POST /api/payments/create-intent` — manual branch

When `payment_gateway = 'manual'`, return without charging:

```json
{ "gateway": "manual", "amount": 200, "qrCodes": [ … ], "simulated": false }
```

No `gatewayPaymentId` is written. Existing surfaces are updated to branch on this
(Section 7.3); `PaymentReturnView` ("pay again") is Maya-only and untouched.

### 5.6 Notifications & types

| Type | Audience | Trigger |
|------|----------|---------|
| `payment_proof` | Staff + Admin | proof submitted (direct createMany; resubmits alert again) |
| `payment_proof_approved` | Customer | staff approval — "Payment verified…" |
| `payment_proof_rejected` | Customer | staff rejection — includes the reason |

`NotificationsDropdown.jsx` `TYPE_CONFIG` gains three entries (lucide icons + the
existing amber/emerald/red chip conventions); `targetTabForNotification` routes staff
`payment_proof` → **Tasks** and customer proof results → **History**.

---

## 6. Customer Experience

### 6.1 Booking flow — `CustomerRentalFlow.jsx` step 2

When `rentalDefaults.payment_gateway === 'manual'` the GCash/Card tiles are replaced by
the **Manual QR payment panel** (shared `ManualQrPayment` component so the same UI can
be embedded in My Rentals later):

1. **Channel chips** — one per admin QR (horizontal scroll on mobile). Selected chip
   uses the brand active style (`border-[#bf4a53] bg-red-50`) matching the existing
   payment-method tiles.
2. **QR card** — white rounded card with the QR image (public URL, no signing
   round-trip), the QR's label + account name, and **"Open full-size QR ↗"** which
   opens an in-page lightbox overlay (mobile-friendly; never a new tab).
3. Instructions — "Scan or save this QR, then verify the recipient in your payment app
   before sending."
4. **Payment reference** — optional text input, ≤40 chars ("Transaction or reference
   number").
5. **Payment screenshot** — file input (PNG/JPG/WebP, max 5 MB), client-side downscale
   via the existing `utils/file.js` pipeline, inline thumbnail preview, remove/replace.
6. Primary button reads **"Submit booking for review"**.

**Submit sequence** (`handleNextInner` manual branch): validate fields → create booking
(now with `paymentPath: 'manual'`) → `POST /bookings/:id/payment-proof` →
success overlay → step 3 receipt. If the proof upload fails after the booking was
created, the booking **stays** (unlike the gateway path's rollback) and the panel shows
a retry affordance: "Your booking is saved — upload your payment proof to continue."
No orphaned state either way; the booking also appears in My Rentals with a resume
action.

**No QR configured:** submission is blocked with "Payment QR not yet set up — contact
the boutique" plus the public store contact from `rental-defaults`; the form never
strands a customer on a dead payment step.

**Receipt (step 3 + `BookingReceipt`)** — pending manual proofs render an amber
**"Payment submitted for review"** banner; the "Paid (downpayment)" line becomes
"Downpayment ₱X — under review". **The UI never claims payment before approval.**

### 6.2 My Rentals resume — customer Home cards

The customer bookings list payload gains the latest proof summary
(`status`, `rejectionReason`, `amount` — one lightweight include on the customer path
only; the staff hot path is untouched). Cards render:

| State | Badge | Action |
|-------|-------|--------|
| Proof pending | `Payment under review` (amber) | none (tap → booking detail) |
| Proof rejected | `Payment not verified` (red) + staff reason | **"Upload payment proof"** → reopens the shared panel in a modal |
| Manual, unpaid, no proof | `Unpaid` (gray) | **"Upload payment proof"** |

Eligibility is state-based (`totalPaid < downpayment`, `paymentPath='manual'` or
`gateway` null, no pending proof) — covering both the customer who lost the page after
paying in their banking app and the rejected resubmission.

---

## 7. Staff & Admin Experience

### 7.1 Staff Tasks — "Payments to verify" card

A new card at the top of `StaffTasksView.jsx` (above Ready for Pickup), styled exactly
like the existing section cards (`bg-white rounded-3xl border border-gray-100/50
shadow-sm`, icon tile `w-10 h-10 rounded-2xl`, title + count badge). Two tabs:

- **Pending** — proof rows: customer, booking code, claimed amount, reference, channel,
  age (`timeAgo` convention), screenshot thumbnail. Click → review modal.
- **Awaiting proof** — abandoned manual bookings (unpaid, no proof under review,
  latest rejection reason shown when present). Keeps held items visible so staff can
  chase or cancel.

Loading uses the existing skeleton conventions; empty states say "All clear".

**Review modal** (`PaymentProofReviewModal.jsx`, bottom-sheet pattern on mobile like
`ReleaseItemModal`):

- Full-size signed screenshot (tap to zoom), booking summary (item, dates, code),
  customer contact (phone/address), claimed amount/reference/channel.
- **Approve** — amount field prefilled with the claimed amount, editable; inline warning
  when the value differs from the claim or lands below the required downpayment. Confirm
  → toast + queue refresh. Errors from the server surface verbatim.
- **Reject** — required reason textarea → confirm.

### 7.2 Counter collection

When the gateway is manual, the counter collect surfaces show the QR panel for the
customer to scan in person; staff verify the transfer on the customer's phone and tap
**"Customer has paid — record payment"**, which calls the existing
`POST /transactions/:id/payments` with `method: 'instapay'` and the channel label in
`notes`. No proof row is created at the counter — the staff member **is** the reviewer.

Surfaces (shared `ManualQrPanel` component):

| Surface | Behavior |
|---------|----------|
| `ReleaseItemModal.jsx` | "Online" channel becomes QR + record; the amount validation is unchanged (full outstanding balance required before release) |
| `TransactionDetailModal.jsx` | Same branch in its collect flow |
| `StaffNewRental.jsx` | "Online" collection creates the booking, shows the QR, records the downpayment on confirmation |

### 7.3 Admin Settings → Integrations

- Gateway selector gains **"Manual QR (InstaPay / bank app)"**; the toast and helper
  text explain the flow ("Customers pay by scanning your QR and uploading a screenshot
  for staff review").
- New **Payment QR codes** manager card (reusing `SettingsCard` primitives): list of
  QRs with preview, label, account name; **Add** (upload → `qrcodes/<slug>-<ts>.jpg`
  via the existing admin storage upload, label, account name), **Edit** (label/account),
  **Delete** (removes the rule entry). Saved through
  `settingsService.updateRules({ manual_qr_codes: JSON.stringify(list) })` — already
  admin + MFA gated.

---

## 8. Design Language (explicit requirement)

Every new surface must match the existing product theme — no new visual language, no
new UI dependencies (lucide-react only):

- **Brand accent `#bf4a53`** for primary buttons, active chip/selection states, and
  focus rings (`focus-visible:ring-[#bf4a53]/40-60`).
- **Cards:** white, `rounded-2xl`/`rounded-3xl`, `border-gray-100/80` (or `/50` for
  large sections), `shadow-sm`; eyebrow labels `text-xs font-bold text-gray-500
  uppercase tracking-wide`.
- **Status semantics** follow the app: amber = pending review, emerald = approved/paid,
  red = rejected, gray = neutral/unpaid.
- **Inputs:** `rounded-xl border-gray-200`, brand focus ring, `text-sm font-bold`
  values with `placeholder-gray-300` — same as the downpayment input.
- **Modals:** bottom-sheet on mobile with drag-to-dismiss and `sm:` centered dialog
  (mirror `ReleaseItemModal`), `aria-label`ed close buttons.
- **Feedback:** existing toast helpers for success/failure; skeletons during loads; no
  `alert()`.
- **Honesty copy** is part of the theme: pending states never read "paid/success".

---

## 9. Demo Mode

`demoInterceptor.js` gains: `manual_qr_codes` (placeholder images) in
`/settings/rental-defaults`; `POST /bookings/:id/payment-proof` (in-memory proof);
`GET /payments/proofs` (seeded with one pending proof + one awaiting booking);
approve/reject mutations; `create-intent` manual branch returning the QR list. The
demo Admin/Staff roles can walk the whole review flow without a backend.

---

## 10. Testing

New `backend/tests/manualQr.test.ts` (plus `setup.ts` mocks for the new model):

- **Submit:** owner-only (403/404 on someone else's booking); cancelled booking 400;
  settled booking 400; booking with an active paymongo/maya charge 400; duplicate
  pending 409; amount is server-derived (booking's downpayment, never the body);
  storage receives a `rental/<txId>/proof-*` key; staff notification created;
  resubmission after rejection allowed; rate limiter kicks in.
- **Approve:** credits through the ledger exactly once (totalPaid up, balance down,
  `Payment.gateway='manual'`, `gatewayRef='proof_<id>'`); double-approve credits nothing
  and still reconciles the row; amount override bounds rejected above outstanding;
  cancelled transaction refused; customer notification + audit log written; approve
  works regardless of the current `payment_gateway` setting.
- **Reject:** reason required (400); non-pending proof 409; customer notified with the
  reason; no money movement.
- **Queue:** staff/admin 200, customer 403; pending and awaiting shapes; awaiting
  excludes bookings with a pending proof and includes rejection reasons.
- **Gateway:** `create-intent` manual branch returns qrCodes + writes no
  `gatewayPaymentId`; `rental-defaults` parses `manual_qr_codes` (and survives
  malformed JSON as `[]`); `recordPayment` accepts `instapay` and still rejects
  garbage.
- **Settings validation:** malformed `manual_qr_codes` payloads rejected with 400.

Regression bar: the entire existing suite stays green (ledger/gateway changes are
additive), backend `tsc` clean, frontend `vite build` passes. Manual QA checklist:
booking end-to-end with manual gateway, rejection → reason → resubmission → approval,
counter collection on Release Item, admin QR upload/edit/delete, staff review modal on
mobile width.

---

## 11. Rollout & Rollback

1. Ship with `payment_gateway` unchanged (`paymongo`) — the deploy is inert until an
   admin flips it. New surfaces are additive and hidden.
2. Apply the additive schema (Section 4.5); verify drift stays 0.
3. Admin uploads the boutique's real QRs → flips the gateway to Manual.
4. Smoke: one real booking (submission → approval → receipt), one counter release.
5. Rollback is the same selector: flip back to PayMongo or Maya. Pending proofs can
   still be approved/rejected (those endpoints do not depend on the current gateway),
   and all proof data stays inert.

Risk notes: abandoned manual bookings hold items — the "Awaiting proof" tab plus the
existing booking notification and staff cancel path cover it; proofs are capped at
5 MB and rate-limited; approval is the single money-moving step and is fully audited.

---

## 12. Out of Scope / Follow-ups

- Customer self-serve balance payment via proof upload (reuses everything here).
- Email notifications for proof events (in-app only in this pass).
- QR reordering and storage-object cleanup on QR delete (ops action today).
- Proof thumbnail derivatives (the service's thumb path is skipped; proofs are viewed
  individually, full-size, by staff).
- Per-channel statistics (which QR gets used most) — the `channel` field records the
  data if this is wanted later.
