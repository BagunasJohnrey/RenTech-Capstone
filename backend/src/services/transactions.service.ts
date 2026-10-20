import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { calculateFees } from '../utils/fees.js';
import QRCode from 'qrcode';
// qrcode.toDataURL promise style
import { assertItemAvailable } from '../utils/availability.js';
import { createAuditLog } from '../utils/audit.js';
import { clearDataCache, cacheOrCompute } from '../utils/ttlCache.js';
import { createNotification, notifyStaffMembers } from './notifications.service.js';
import { sendSms, applyTemplate } from './semaphore.service.js';
import { sendBookingConfirmationEmail, sendPickupEmail, sendReturnEmail, sendCancellationEmail, sendEmail, isSendableEmail } from './brevo.service.js';
import { checkPromo, consumePromoUse } from './promoCodes.service.js';
import { verifyDiscountPin } from './auth.service.js';
import { getBusinessRules, getFeatureFlags, isSmsEnabled } from './settings.service.js';
import { ItemStatus, TransactionStatus, Prisma } from '@prisma/client';

// After an item is returned it enters a cleaning window of this many days
// before it can be rented again. Staff manually flip the item back to
// Available once cleaning is finished.
const CLEANING_DELAY_DAYS = 1;

// SECURITY: the price charged for a rental is ALWAYS derived server-side from
// the item. Client-supplied rentalFee values are ignored (never trusted).
// Applies the sale price when the item's sale is active.
export function effectiveItemPrice(item: {
  price: number;
  onSale?: boolean | null;
  discountPct?: number | null;
  salePrice?: number | null;
  saleEndsAt?: Date | null;
}): number {
  if (
    item.onSale &&
    (!item.saleEndsAt || item.saleEndsAt > new Date())
  ) {
    if (item.salePrice != null && item.salePrice > 0) return item.salePrice;
    if (item.discountPct != null && item.discountPct > 0) {
      return Math.round(item.price * (1 - item.discountPct / 100) * 100) / 100;
    }
  }
  return item.price;
}

interface CreateRentalInput {
  customerId: string;
  itemId: number;
  rentalDate: string;
  dueDate: string;
  rentalFee?: number;            // IGNORED — derived from the item server-side
  downpayment?: number;
  notes?: string;
  conditionPhoto?: string;
  promoCode?: string;            // resolved + consumed server-side
  promoCodeId?: string;          // legacy: only honored when it matches a real promo
  // Staff counter discount: percent + the admin PIN that approved it. Only
  // honored on the staff route (processedById set) and re-verified
  // server-side at booking time — the client-side PIN check alone is not
  // trusted, and the approved numbers are persisted on the row for audit.
  staffDiscountPct?: number;
  staffDiscountPin?: string;
  size?: string;
  measurements?: unknown;
  // Address typed at booking time (customer flow) — persisted on the profile
  // inside the booking transaction so the staff queue shows a real address.
  customerAddress?: string;
  requireMinimumDownpayment?: boolean; // customers must put down the flat min_downpayment floor (default ₱200)
  // Staff-only: the downpayment cash was physically collected at the counter,
  // so write it as a completed Payment row atomically with the booking.
  // Online bookings must leave this false — the gateway webhook credits the
  // downpayment when the money actually lands (pre-creating a row here would
  // double-count it). The staff controller forces this false for customers.
  downpaymentCash?: boolean;
  paymentPath?: 'manual';
  // Manual-QR checkout: the proof image is uploaded BEFORE the booking is
  // created, then its row is inserted inside the same DB transaction as the
  // booking. A failed upload therefore leaves no booking behind.
  paymentProof?: {
    imagePath: string;
    reference?: string;
    channel?: string;
  };
}

export async function createRental(data: CreateRentalInput, processedById?: string) {
  const item = await prisma.inventoryItem.findUnique({ where: { id: data.itemId } });
  if (!item) throw new AppError(404, 'Item not found');

  // Distinguish a bogus customerId (404) from a date overlap (409) so booking
  // flows surface the right error instead of a confusing unavailable-dates 409.
  const customer = await prisma.profile.findUnique({ where: { id: data.customerId } });
  if (!customer) throw new AppError(404, 'Customer not found');

  // Compute effective availability
  if (item.status === ItemStatus.OutOfService) {
    throw new AppError(400, 'Item is out of service and cannot be rented');
  }

  // An item being cleaned after a return cannot be booked until staff
  // manually flips its status back (batch cleaning workflow).
  if (item.status === ItemStatus.Cleaning) {
    throw new AppError(409, 'Item is unavailable for the selected dates (being cleaned)');
  }

  // SECURITY + validation: derive the price from the item, never the client.
  const baseFee = effectiveItemPrice(item);

  // Resolve the promo server-side WITHOUT consuming a use yet. Consumption is
  // deferred to inside the booking $transaction (atomic + rollback-safe), so a
  // failed booking never burns a promo use or the per-customer cap.
  // checkPromo enforces everything advisories + booking rules: active window,
  // min spend, category scope, per-customer cap, and first-timer codes.
  let fee = baseFee;
  let promoCodeId: string | undefined;
  let promoToConsume: string | undefined;
  if (data.promoCode) {
    const promo = await checkPromo(data.promoCode, baseFee, {
      customerId: data.customerId,
      itemCategory: item.category ?? undefined,
    });
    fee = promo.finalFee;
    promoCodeId = promo.promoCodeId;
    promoToConsume = promo.promoCodeId;
  } else if (data.promoCodeId) {
    const promo = await prisma.promoCode.findUnique({ where: { id: data.promoCodeId } });
    if (promo && promo.isActive) promoCodeId = promo.id;
  }

  // Staff counter discount (staff route only — processedById is set only
  // there; customers calling createRental directly have no processedById so
  // these fields are dead for them). The PIN is re-verified here so a forged
  // client can't self-approve a discount; the pct is clamped to the same
  // 0–50 range as the staff UI slider.
  let staffDiscountPct: number | undefined;
  let staffDiscountBy: string | undefined;
  if (processedById && (data.staffDiscountPct ?? 0) > 0) {
    const pct = Math.min(50, Math.max(0, Number(data.staffDiscountPct)));
    if (!(pct > 0)) throw new AppError(400, 'Invalid staff discount');
    if (!data.staffDiscountPin) throw new AppError(401, 'Admin approval (PIN) is required for the staff discount');
    const approver = await verifyDiscountPin(String(data.staffDiscountPin));
    if (!approver) throw new AppError(401, 'Invalid admin PIN');
    staffDiscountPct = pct;
    staffDiscountBy = approver.name;
    fee = Math.round(fee * (1 - pct / 100) * 100) / 100;
  }

  const downpayment = Math.min(data.downpayment ?? 0, fee);
  if (downpayment < 0 || downpayment > fee) {
    throw new AppError(400, `Downpayment must be between ₱0 and ₱${fee.toLocaleString()}`);
  }
  if (data.requireMinimumDownpayment) {
    // Flat minimum downpayment from admin business rules (default ₱200),
    // never more than the full fee.
    const rules = await getBusinessRules();
    const flatMin = parseInt(rules.min_downpayment ?? '200', 10) || 200;
    const min = Math.min(flatMin, fee);
    if (downpayment < min) {
      throw new AppError(400, `Downpayment must be at least ₱${min.toLocaleString()}`);
    }
  }

  const start = new Date(data.rentalDate);
  const end = new Date(data.dueDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError(400, 'Invalid rentalDate/dueDate');
  }
  if (start.getTime() > end.getTime()) {
    throw new AppError(400, 'Pickup date must be on or before the due date');
  }
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (start.getTime() < todayStart.getTime()) {
    throw new AppError(400, 'Pickup date cannot be in the past');
  }

  // A booking whose rental starts in the future is an "upcoming hold": the
  // transaction is created as Reserved (and the item held as Reserved) until
  // staff release/pick it up, at which point it becomes Active/Rented.
  const isFuture = start.getTime() > todayStart.getTime();

  // Only currently-active rentals/reservations block a new booking. Returned
  // transactions are no longer shown — the item is in Cleaning status instead.
  // The next pickup may only start CLEANING_DELAY_DAYS after a previous due
  // date, so shift the requested start back by that delay.
  const startMinusDelay = new Date(start);
  startMinusDelay.setDate(startMinusDelay.getDate() - CLEANING_DELAY_DAYS);

  const overlapWhere: Prisma.TransactionWhereInput = {
    itemId: data.itemId,
    status: { in: ['Active', 'Overdue', 'Reserved'] as TransactionStatus[] },
    rentalDate: { lte: end },
    dueDate: { gte: startMinusDelay },
  };
  const activeWhere: Prisma.TransactionWhereInput = {
    itemId: item.id,
    status: { in: ['Active', 'Overdue', 'Reserved'] as TransactionStatus[] },
  };

  // ATOMIC: run the availability re-check + insert + status flip in ONE
  // Serializable transaction. A second concurrent booking for the same
  // item/date now either sees the first's rows (overlap -> 409) or fails with
  // a serialization/unique conflict (caught below -> 409), so two customers
  // can never both pass the check before either commits.
  let transaction;
  try {
    transaction = await prisma.$transaction(async (tx) => {
      const activeTx = await tx.transaction.findFirst({ where: activeWhere, select: { id: true } });

      // Stale Rented/Reserved without an active transaction → treat as available
      if ((item.status === ItemStatus.Rented || item.status === ItemStatus.Reserved) && !activeTx) {
        await tx.inventoryItem.update({ where: { id: item.id }, data: { status: ItemStatus.Available } });
      }

      const overlapping = await tx.transaction.findFirst({ where: overlapWhere });
      if (overlapping) {
        throw new AppError(409, 'Item is unavailable for the selected dates (rented or being cleaned)');
      }

      // Consume the promo atomically INSIDE the booking transaction. On any
      // later failure the whole transaction rolls back, so the use is never
      // burned for a booking that didn't commit; the atomic updateMany guard
      // (currentUses < maxUses) prevents over-consumption under concurrency.
      if (promoToConsume) {
        await tx.promoCode.updateMany({
          where: { id: promoToConsume, OR: [{ maxUses: null }, { currentUses: { lt: prisma.promoCode.fields.maxUses } }] },
          data: { currentUses: { increment: 1 } },
        }).then((r) => {
          if (r.count === 0) throw new AppError(400, 'Promo code has reached its usage limit');
        });
      }

      const balance = fee - downpayment;

      const created = await tx.transaction.create({
        data: {
          customerId: data.customerId,
          processedById: processedById ?? null,
          // Staff audit: who assisted this booking (walk-ins included). Set
          // ONCE here and never overwritten — release/return write their own
          // columns/logs instead of clobbering this. Null = online booking.
          assistedById: processedById ?? null,
          itemId: data.itemId,
          rentalDate: start,
          dueDate: end,
          status: isFuture ? TransactionStatus.Reserved : TransactionStatus.Active,
          rentalFee: fee,
          downpayment,
          // A cash-collected downpayment is money in hand: totalPaid starts
          // there (the completed row below proves it). A promised/gateway
          // downpayment starts at 0 until the ledger credits it.
          totalPaid: data.downpaymentCash && downpayment > 0 ? downpayment : 0,
          balance,
          promoCodeId: promoCodeId ?? null,
          staffDiscountPct: staffDiscountPct ?? null,
          staffDiscountBy: staffDiscountBy ?? null,
          size: data.size ?? null,
          measurements: data.measurements as Prisma.InputJsonValue | undefined,
          notes: data.notes ?? null,
          conditionPhoto: data.conditionPhoto ?? null,
          // Auto-flag alteration when the customer provides custom measurements
          // (body sizes that differ from the garment's base size). Staff can
          // override later; manual-size bookings skip this entirely.
          alterationStatus: data.measurements && Object.keys(data.measurements).length > 0 ? 'pending' : null,
          paymentPath: data.paymentPath === 'manual' ? 'manual' : null,
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          item: { select: { id: true, name: true, category: true } },
        },
      });

      // Counter cash: the staff physically holds this money, so the booking
      // opens with a completed Payment row (same shape as recordPayment).
      // Without it the cash would exist only as a `downpayment` number and
      // never appear in revenue. Online bookings skip this — the gateway
      // webhook credits the same amount when it lands.
      if (data.downpaymentCash && downpayment > 0) {
        await tx.payment.create({
          data: {
            transactionId: created.id,
            amount: downpayment,
            method: 'cash',
            type: balance <= 0 ? 'full' : 'partial',
            status: 'completed',
          },
        });
      }

      // Keep the saved address in step with what the customer entered for this
      // booking (new signups may have a blank profile address). Atomic with the
      // booking so staff never see a booking whose address update was lost.
      if (data.customerAddress) {
        await tx.profile.update({
          where: { id: data.customerId },
          data: { address: data.customerAddress },
        });
      }

      // Manual-QR proof is part of the booking itself: if this insert fails the
      // whole booking rolls back, so no unpaid booking can exist without the
      // screenshot staff need to verify. The image was already uploaded by the
      // caller (and is cleaned up there if this transaction fails).
      if (data.paymentProof) {
        if (downpayment <= 0) {
          throw new AppError(400, 'A downpayment is required to submit a payment proof');
        }
        await tx.paymentProof.create({
          data: {
            transactionId: created.id,
            amount: downpayment,
            reference: data.paymentProof.reference?.trim() || null,
            channel: data.paymentProof.channel?.trim() || null,
            imagePath: data.paymentProof.imagePath,
            status: 'pending',
          },
        });
      }

      await tx.inventoryItem.update({
        where: { id: data.itemId },
        data: { status: isFuture ? ItemStatus.Reserved : ItemStatus.Rented },
      });

      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(409, 'Item is unavailable for the selected dates');
    }
    throw err;
  }

  await createAuditLog({
    action: 'create',
    entity: 'transaction',
    entityId: transaction.id,
    performedById: processedById,
    newValue: { transactionId: transaction.id, itemId: data.itemId, customerId: data.customerId, assistedById: processedById ?? null },
  });

  // Manual-QR bookings have money under review at this point, so they get an
  // honest "payment under review" notice — never a confirmation that implies
  // the downpayment was already verified.
  const proofPending = Boolean(data.paymentProof);

  // Auto-confirmation notification
  try {
    await createNotification(proofPending
      ? {
          profileId: data.customerId,
          transactionId: transaction.id,
          type: 'payment_proof_pending',
          title: 'Payment under review',
          message: `We received your booking for "${transaction.item.name}" and your payment screenshot. Our team will verify the downpayment before pickup — we'll notify you once it's approved.`,
        }
      : {
          profileId: data.customerId,
          transactionId: transaction.id,
          type: 'booking_confirmation',
          title: 'Booking Confirmed',
          message: `Your rental of "${transaction.item.name}" is confirmed. Due back ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`,
        });
  } catch { /* notification is non-critical */ }

  // Staff alert: a new booking was created.
  try {
    await notifyStaffMembers({
      transactionId: transaction.id,
      type: 'new_booking',
      title: 'New Booking',
      message: `${transaction.customer.name} booked "${transaction.item.name}" — due ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`,
    });
  } catch { /* notification is non-critical */ }

  // Attach a real, scannable QR (data URI) — but ONLY while the QR feature is
  // enabled (`qr_booking_codes` business rule). When the admin turns QR off, the
  // server stops shipping any QR payload so no client can render one. Encodes
  // `RT-<8 char tx id>` matching the booking code on receipts. Non-critical: a
  // QR generation failure must never block a booking.
  let qrCodeDataUri: string | undefined;
  try {
    const flags = await getFeatureFlags();
    if (flags.qr_booking_codes) {
      qrCodeDataUri = await QRCode.toDataURL(`RT-${String(transaction.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
    }
  } catch { /* QR generation is non-critical */ }
  (transaction as Record<string, unknown>).qrCodeDataUri = qrCodeDataUri;

  // Auto-confirmation SMS — skipped when the customer opted out
  // (notifyPrefs.booking === false). The in-app + staff alerts above still
  // fire, mirroring the overdue opt-out behavior.
  try {
    const customerProfile = await prisma.profile.findUnique({ where: { id: data.customerId } });
    const prefs = (customerProfile as { notifyPrefs?: Record<string, boolean> | null } | null)?.notifyPrefs;
    // Global kill-switch ANDs on top of the per-account opt-out (manual staff
    // sends bypass this on purpose — only automatic texts are gated).
    const smsGloballyOn = await isSmsEnabled().catch(() => true);
    const wantsBookingSms = smsGloballyOn && (!prefs || prefs.booking !== false);
    if (customerProfile?.phone && wantsBookingSms) {
      const template = proofPending ? null : await prisma.smsTemplate.findFirst({ where: { name: 'booking_confirmation' } });
      const message = proofPending
        ? `Hi ${customerProfile.name}, we received your booking for "${transaction.item.name}". Your payment screenshot is under review. We'll text you once the downpayment is verified.`
        : template?.content
          ? applyTemplate(template.content, {
              customer: customerProfile.name,
              item: transaction.item.name,
              date: end.toLocaleDateString('en-PH'),
              days: String(Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))),
            })
          : `Hi ${customerProfile.name}, your rental of "${transaction.item.name}" is confirmed. Due back ${end.toLocaleDateString('en-PH')}. Thank you!`;

      await sendSms(customerProfile.phone, message).then(() =>
        prisma.sentSms.create({
          data: {
            profileId: data.customerId,
            transactionId: transaction.id,
            message,
            status: 'sent',
          },
        })
      ).catch(() => {});
    }

    // Order-confirmation email (Brevo, best-effort — never blocks the booking).
    // Skipped for walk-in synthetic addresses (isSendableEmail) and for
    // customers who opted out of email (notifyPrefs.email === false).
    try {
      const prefs = (customerProfile as { notifyPrefs?: Record<string, boolean> | null } | null)?.notifyPrefs;
      const wantsEmail = !prefs || prefs.email !== false;
      if (customerProfile?.email && wantsEmail) {
        await sendBookingConfirmationEmail(customerProfile.email, {
          customerName: customerProfile.name,
          itemName: transaction.item.name,
          pickupDate: start.toLocaleDateString('en-PH'),
          dueDate: end.toLocaleDateString('en-PH'),
          rentalFee: fee,
          downpayment,
          balance: fee - downpayment,
          bookingCode: `RT-${String(transaction.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
          qrCodeDataUri,
          paymentPending: proofPending,
        });
      }
    } catch { /* email is non-critical */ }
  } catch { /* SMS is non-critical */ }

  // New booking changes revenue/rental counts — drop the dashboard cache so
  // the next load is computed from fresh data.
  clearDataCache();

  return transaction;
}

// Staff audit selects: every full-record read carries who assisted the
// booking, who released the item, and who last handled it.
const staffAuditSelect = {
  customer: { select: { id: true, name: true, email: true, phone: true, address: true } },
  processedBy: { select: { id: true, name: true } },
  assistedBy: { select: { id: true, name: true } },
  releasedBy: { select: { id: true, name: true } },
} as const;

export async function getTransaction(id: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id },
    include: {
      ...staffAuditSelect,
      item: true,
      payments: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!tx) throw new AppError(404, 'Transaction not found');
  return tx;
}

// Look up a booking for the staff QR scanner by its short booking code
// (`RT-XXXXXXXX`, the first 8 hex chars of the transaction UUID, uppercase).
// QR payloads may also carry a shareable URL like `...?tx=RT-XXXXXXXX` — the
// controller extracts the code before calling this.
export async function getTransactionByBookingCode(code: string) {
  const clean = String(code).trim().toUpperCase().replace(/^RT-/, '');
  if (!/^[0-9A-F]{6,8}$/.test(clean)) {
    throw new AppError(404, 'Booking not found for this QR code');
  }
  const tx = await prisma.transaction.findFirst({
    where: { id: { startsWith: clean.toLowerCase() } },
    include: {
      ...staffAuditSelect,
      item: true,
      payments: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!tx) throw new AppError(404, 'Booking not found for this QR code');
  return tx;
}

export async function listTransactions(params: {
  role: string;
  profileId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};

  if (params.role === 'Customer') {
    if (!params.profileId) throw new Error('profileId is required for customer transaction lists');
    where.customerId = params.profileId;
  }

  if (params.status) {
    where.status = params.status;
  }

  // Perf: this is the single heaviest staff-screen query (~10-15s for ~300
  // rows against the remote pooler — the pooler serializes payloads, so bytes
  // matter as much as round trips). Three cuts vs the old shape:
  //   - assistedBy/releasedBy includes dropped: the staff detail timeline
  //     resolves staff names from /:id/audits, and the detail modal enriches
  //     via getById — list rows never rendered these objects.
  //   - customer.email dropped: no list row renders it (call/SMS buttons use
  //     the phone). The detail modal carries email via its own fetch.
  //   - the `total` COUNT round-trip is dropped: it scanned the whole table
  //     for a number no screen renders (pagination is client-side over the
  //     list); total is now the returned row count.
  // Unfiltered staff lists (the hot path — Dashboard + Tasks + History all
  // mount it) are cached with the same TTL discipline as the dashboard data.
  // Every mutation path (booking/return/cancel/release/payment/status/scheduler
  // flag flips via clearDataCache) invalidates, so the list is never older
  // than the latest change. Filtered/paginated/customer views bypass the
  // cache and hit the DB directly so they stay exact.
  const isHotPath = params.role !== 'Customer' && !params.status && !params.offset && (params.limit ?? 500) >= 500;
  const compute = () => listTransactionsUncached(where, params.limit ?? 500, params.offset || 0, params.role === 'Customer');
  const transactions = isHotPath
    ? await cacheOrCompute('transactions:staff:full', compute)
    : await compute();

  return { transactions, total: transactions.length };
}

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

export async function processReturn(
  transactionId: string,
  processedById: string,
  returnDate: string,
  isDamaged: boolean,
  returnPhoto?: string,
  notes?: string,
  damageReason?: string,
  damageFeeOverride?: number | null
) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      item: true,
      customer: { select: { id: true, name: true } },
    },
  });

  if (!tx) throw new AppError(404, 'Transaction not found');
  if (tx.status === 'Returned') throw new AppError(400, 'Transaction already returned');
  if (tx.status === 'Cancelled') throw new AppError(400, 'Transaction was cancelled');
  // No return before release: a Reserved booking is an upcoming hold the
  // customer hasn't picked up yet — returning it would send the item to
  // Cleaning for a rental that never happened.
  if (tx.status === 'Reserved') throw new AppError(400, 'Item has not been released yet — release it at pickup first');

  // No return until fully paid: the rental balance (fee − amounts actually
  // credited) must be zero first. Staff settle it via Record Payment (counter
  // or Online tab), then process the return. Damage assessed at return may
  // leave a new balance — that stays payable post-return (see recordPayment).
  if (tx.balance > 0) {
    throw new AppError(400, `Settle the outstanding balance of ₱${Number(tx.balance).toLocaleString()} before returning`);
  }

  const retDate = new Date(returnDate);
  const fees = await calculateFees(tx.rentalDate, tx.dueDate, retDate, isDamaged, {
    damageFee: damageFeeOverride,
  });

  const additionalCharges = fees.latePenalty + fees.damageFee;
  const newBalance = tx.balance + additionalCharges;

  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      returnDate: retDate,
      status: TransactionStatus.Returned,
      latePenalty: fees.latePenalty,
      damageFee: fees.damageFee,
      balance: Math.max(0, newBalance),
      returnPhoto: returnPhoto ?? null,
      damageReason: isDamaged ? (damageReason ?? null) : null,
      notes: notes ?? undefined,
      processedById,
    },
  });

  // A damaged return takes the item OUT of rotation entirely (skips cleaning
  // — it can't be rented again until staff repair it). An intact return goes
  // to Cleaning for the staff to process in batches.
  await prisma.inventoryItem.update({
    where: { id: tx.itemId },
    data: isDamaged
      ? { status: ItemStatus.OutOfService, outOfServiceReason: damageReason ?? 'damaged' }
      : { status: ItemStatus.Cleaning },
  });

  await createAuditLog({
    action: 'update',
    entity: 'transaction',
    entityId: transactionId,
    performedById: processedById,
    newValue: { status: 'Returned', latePenalty: fees.latePenalty, damageFee: fees.damageFee, damageReason: isDamaged ? (damageReason ?? null) : null },
    oldValue: { status: tx.status },
  });

  // Staff alert: late return (only when returned after the due date).
  // No penalty is charged (late fees removed) — this is an FYI for the queue.
  if (retDate.getTime() > tx.dueDate.getTime()) {
    try {
      await notifyStaffMembers({
        transactionId,
        type: 'late_return',
        title: 'Late Return',
        message: `${tx.customer.name} returned "${tx.item.name}" late (no penalty charged).`,
      });
    } catch { /* notification is non-critical */ }
  }

  // Order-return email (Brevo receipt + thank-you, best-effort).
  try {
    const customerProfile = await prisma.profile.findUnique({ where: { id: tx.customerId } });
    const prefs = (customerProfile as { notifyPrefs?: Record<string, boolean> | null } | null)?.notifyPrefs;
    const wantsEmail = !prefs || prefs.email !== false;
    if (customerProfile?.email && wantsEmail) {
      await sendReturnEmail(customerProfile.email, customerProfile.name, tx.item.name, {
        latePenalty: fees.latePenalty,
        damageFee: fees.damageFee,
        damageReason: isDamaged ? (damageReason ?? null) : null,
      });
    }
  } catch { /* email is non-critical */ }

  clearDataCache();

  return { ...updated, fees };
}

// EDIT booking details (dates + notes + alteration status) without
// cancel+re-book. Reuses the same overlap check as createRental so an edit
// can't collide with another booking, and runs read+check+update in one
// Serializable transaction.
export async function updateTransaction(
  transactionId: string,
  performedById: string,
  patch: { rentalDate?: string; dueDate?: string; notes?: string; alterationStatus?: 'pending' | 'ready' | null }
) {
  const existing = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true, itemId: true, status: true, rentalDate: true, dueDate: true, notes: true,
      alterationStatus: true, customerId: true, item: { select: { id: true, name: true } },
    },
  });
  if (!existing) throw new AppError(404, 'Transaction not found');
  if (existing.status === 'Returned') throw new AppError(400, 'Cannot edit a returned transaction');
  if (existing.status === 'Cancelled') throw new AppError(400, 'Cannot edit a cancelled transaction');

  const nextRental = patch.rentalDate ? new Date(patch.rentalDate) : existing.rentalDate;
  const nextDue = patch.dueDate ? new Date(patch.dueDate) : existing.dueDate;
  if (isNaN(nextRental.getTime()) || isNaN(nextDue.getTime())) {
    throw new AppError(400, 'Invalid rentalDate/dueDate');
  }
  if (nextRental.getTime() > nextDue.getTime()) {
    throw new AppError(400, 'Pickup date must be on or before the due date');
  }
  if (patch.alterationStatus !== undefined && patch.alterationStatus !== null &&
      patch.alterationStatus !== 'pending' && patch.alterationStatus !== 'ready') {
    throw new AppError(400, 'Invalid alteration status');
  }
  const datesChanged =
    nextRental.getTime() !== existing.rentalDate.getTime() ||
    nextDue.getTime() !== existing.dueDate.getTime();

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      await assertItemAvailable(
        {
          itemId: existing.itemId,
          rentalDate: nextRental,
          dueDate: nextDue,
          excludeTxId: transactionId,
          cleaningDelayDays: CLEANING_DELAY_DAYS,
        },
        tx
      );

      return tx.transaction.update({
        where: { id: transactionId },
        data: {
          rentalDate: nextRental,
          dueDate: nextDue,
          notes: patch.notes !== undefined ? patch.notes : existing.notes,
          ...(patch.alterationStatus !== undefined ? { alterationStatus: patch.alterationStatus } : {}),
        },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          item: { select: { id: true, name: true, category: true } },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(409, 'Item is unavailable for the selected dates');
    }
    throw err;
  }

  await createAuditLog({
    action: 'update',
    entity: 'transaction',
    entityId: transactionId,
    performedById,
    oldValue: { rentalDate: existing.rentalDate, dueDate: existing.dueDate, notes: existing.notes, alterationStatus: existing.alterationStatus ?? null },
    newValue: { rentalDate: nextRental, dueDate: nextDue, notes: updated.notes, alterationStatus: (updated as { alterationStatus?: string | null }).alterationStatus ?? null },
  });

  // Staff moved the dates (e.g. alteration running late) — tell the customer
  // in-app + by email (best-effort, never blocks the edit). Alteration-only
  // flips stay silent to avoid spamming for tailor progress.
  if (datesChanged) {
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    try {
      await createNotification({
        profileId: existing.customerId,
        transactionId,
        type: 'booking_updated',
        title: 'Booking dates updated',
        message: `Your rental of "${existing.item.name}" moved to pickup ${fmt(nextRental)}, return by ${fmt(nextDue)}.`,
      });
    } catch { /* notification is non-critical */ }
    try {
      const customerProfile = await prisma.profile.findUnique({ where: { id: existing.customerId } });
      const prefs = (customerProfile as { notifyPrefs?: Record<string, boolean> | null } | null)?.notifyPrefs;
      const wantsEmail = !prefs || prefs.email !== false;
      if (customerProfile?.email && wantsEmail) {
        if (isSendableEmail(customerProfile.email)) {
          await sendEmail({
            to: customerProfile.email,
            subject: `Booking dates updated: ${existing.item.name} — RenTech`,
            html: `<p>Hi ${customerProfile.name},</p><p>Your rental of "<strong>${existing.item.name}</strong>" was moved to <strong>pickup ${fmt(nextRental)}</strong>, <strong>return by ${fmt(nextDue)}</strong>.</p><p>RenTech · Balayan, Batangas</p>`,
            text: `Hi ${customerProfile.name},\n\nYour rental of "${existing.item.name}" was moved to pickup ${fmt(nextRental)}, return by ${fmt(nextDue)}.\n\nRenTech · Balayan, Batangas`,
          });
        }
      }
    } catch { /* email is non-critical */ }
  }

  clearDataCache();

  return updated;
}

// AT-PICKUP item swap (in-shop): the customer is at the counter, sees a
// better garment, and staff moves the SAME booking record onto it — dates,
// customer, and payment history stay put, only the garment (and its derived
// price) changes. Agreed policy:
//   - promo/coupon is CARRIED OVER when it still validates against the new
//     item's price/category (use transfers with the row); otherwise voided
//     and the consumed use is handed back;
//   - downpayment stays exactly as paid — NO refunds, so balance floors at 0;
//   - size/measurements are cleared (different garment, different fit);
//   - any release photo is voided (it documented the wrong garment), so the
//     new item must be released + photographed normally afterwards.
export async function swapBookingItem(
  transactionId: string,
  performedById: string,
  newItemId: number
) {
  const existing = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      item: true,
      customer: { select: { id: true, name: true, email: true } },
    },
  });
  if (!existing) throw new AppError(404, 'Transaction not found');
  if (existing.status === 'Returned') throw new AppError(400, 'Cannot swap the item on a returned transaction');
  if (existing.status === 'Cancelled') throw new AppError(400, 'Cannot swap the item on a cancelled transaction');
  if (existing.status === 'Overdue') throw new AppError(400, 'Cannot swap the item — the rental is already out');
  if (existing.itemId === newItemId) throw new AppError(400, 'This booking is already on the selected item');

  const replacement = await prisma.inventoryItem.findUnique({ where: { id: newItemId } });
  if (!replacement || replacement.status === ItemStatus.Deleted) throw new AppError(404, 'Replacement item not found');
  if (replacement.status === ItemStatus.OutOfService) {
    throw new AppError(400, 'Replacement item is out of service and cannot be rented');
  }
  if (replacement.status === ItemStatus.Cleaning) {
    throw new AppError(409, 'Replacement item is unavailable for the selected dates (being cleaned)');
  }

  const newFee = effectiveItemPrice(replacement);
  const oldNotes = existing.notes ?? null;
  // Promo carry-over is resolved INSIDE the $transaction below (reads the
  // code row + re-validates against the replacement's fee/category with the
  // row itself excluded from the cap count). Kept → the consumed use
  // transfers with the row, no double-charge. Invalid there → the use is
  // handed back and the promo voided.

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      await assertItemAvailable(
        {
          itemId: newItemId,
          rentalDate: existing.rentalDate,
          dueDate: existing.dueDate,
          excludeTxId: transactionId,
          cleaningDelayDays: CLEANING_DELAY_DAYS,
        },
        tx
      );

      // Promo carry-over: re-validate the old code against the replacement.
      // Still valid (new fee + category + caps, own row excluded) → keep it
      // and charge the re-validated fee, the consumed use transferring with
      // the row. Invalid → hand the use back and void it.
      let keptPromoCodeId: string | null = null;
      let fee = newFee;
      if (existing.promoCodeId) {
        const oldPromo = await tx.promoCode.findUnique({ where: { id: existing.promoCodeId } });
        let revalidated = false;
        if (oldPromo) {
          try {
            const re = await checkPromo(oldPromo.code, newFee, {
              client: tx,
              customerId: existing.customerId,
              itemCategory: replacement.category ?? undefined,
              excludeTransactionId: transactionId,
            });
            keptPromoCodeId = oldPromo.id;
            fee = re.finalFee;
            revalidated = true;
          } catch {
            revalidated = false;
          }
        }
        if (!revalidated) {
          await tx.promoCode.updateMany({
            where: { id: existing.promoCodeId, currentUses: { gt: 0 } },
            data: { currentUses: { decrement: 1 } },
          });
        }
      }
      const promoKept = keptPromoCodeId !== null;
      const swapNote =
        `Item swapped at pickup: "${existing.item.name}" → "${replacement.name}" ` +
        `(fee ₱${existing.rentalFee.toLocaleString()} → ₱${fee.toLocaleString()}; ` +
        `${promoKept ? 'promo carried over' : 'promo voided'}, downpayment kept)`;

      // Downpayment is historical (what was actually paid) — never touched.
      // Balance recomputes against the new fee and floors at 0: swapping to a
      // cheaper item forfeits the overpayment, per boutique policy (no refunds).
      const balance = Math.max(0, fee - existing.totalPaid);

      // Optimistic lock on updatedAt: a concurrent release/return touching the
      // same row makes this a 409 ("please retry") instead of silently
      // half-applying the swap over a release.
      const res = await tx.transaction.updateMany({
        where: { id: transactionId, updatedAt: existing.updatedAt },
        data: {
          itemId: newItemId,
          rentalFee: fee,
          balance,
          promoCodeId: keptPromoCodeId,
          size: null,
          // DbNull clears the column (plain `null` is not assignable to the
          // nullable-JSON update type and `undefined` would leave it untouched).
          measurements: Prisma.DbNull,
          releasePhoto: null,
          releasedById: null,
          notes: oldNotes ? `${oldNotes}\n${swapNote}` : swapNote,
        },
      });
      if (res.count === 0) throw new AppError(409, 'Booking changed while swapping — please retry');

      // Old garment back to the pool (same rule as cancellation); new one held
      // exactly like a fresh booking (future pickup → Reserved, today → Rented).
      if (existing.item.status !== ItemStatus.OutOfService) {
        await tx.inventoryItem.update({
          where: { id: existing.itemId },
          data: { status: ItemStatus.Available, outOfServiceReason: null },
        });
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const isFuture = existing.rentalDate.getTime() > todayStart.getTime();
      await tx.inventoryItem.update({
        where: { id: newItemId },
        data: { status: isFuture ? ItemStatus.Reserved : ItemStatus.Rented },
      });

      return tx.transaction.findUnique({
        where: { id: transactionId },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          item: { select: { id: true, name: true, category: true } },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      throw new AppError(409, 'Replacement item is unavailable for the selected dates');
    }
    throw err;
  }

  await createAuditLog({
    action: 'item_swap',
    entity: 'transaction',
    entityId: transactionId,
    performedById,
    oldValue: { itemId: existing.itemId, itemName: existing.item.name, rentalFee: existing.rentalFee, promoCodeId: existing.promoCodeId, balance: existing.balance },
    newValue: { itemId: newItemId, itemName: replacement.name, rentalFee: updated!.rentalFee, promoCodeId: updated!.promoCodeId, balance: updated!.balance },
  });

  // Tell the customer in-app + by email (best-effort, never blocks the swap).
  const moneyLine = updated!.balance > 0
    ? ` New balance: ₱${Number(updated!.balance).toLocaleString()} — please settle it at the counter.`
    : ' Nothing more to pay.';
  try {
    await createNotification({
      profileId: existing.customerId,
      transactionId,
      type: 'booking_updated',
      title: 'Rental item changed',
      message: `Your rental was changed from "${existing.item.name}" to "${replacement.name}".${moneyLine}`,
    });
  } catch { /* notification is non-critical */ }
  try {
    const customerProfile = await prisma.profile.findUnique({ where: { id: existing.customerId } });
    const prefs = (customerProfile as { notifyPrefs?: Record<string, boolean> | null } | null)?.notifyPrefs;
    const wantsEmail = !prefs || prefs.email !== false;
    if (customerProfile?.email && wantsEmail && isSendableEmail(customerProfile.email)) {
      await sendEmail({
        to: customerProfile.email,
        subject: `Rental item changed: ${replacement.name} — RenTech`,
        html: `<p>Hi ${customerProfile.name},</p><p>At pickup your rental was changed from "<strong>${existing.item.name}</strong>" to "<strong>${replacement.name}</strong>".${moneyLine}</p><p>RenTech · Balayan, Batangas</p>`,
        text: `Hi ${customerProfile.name},\n\nAt pickup your rental was changed from "${existing.item.name}" to "${replacement.name}".${moneyLine}\n\nRenTech · Balayan, Batangas`,
      });
    }
  } catch { /* email is non-critical */ }

  clearDataCache();

  return {
    ...updated,
    swappedFrom: { id: existing.itemId, name: existing.item.name },
    previousFee: existing.rentalFee,
    promoVoided: !!existing.promoCodeId && !updated!.promoCodeId,
    promoKept: !!updated!.promoCodeId,
  };
}

// Recomputes a transaction-derived item status (Rented/Reserved/Available)
// from the remaining live holds after a booking leaves the pool (cancel or
// delete). A second live hold keeps the item out; manual states (Cleaning
// batch, OutOfService damage, Deleted) are never touched. Returns the
// resulting status so callers can sync the UI to the same value.
async function recomputeItemStatusAfterRelease(
  itemId: number,
  excludeTxId: string | null,
  currentStatus: ItemStatus
): Promise<ItemStatus> {
  if (currentStatus !== ItemStatus.Rented && currentStatus !== ItemStatus.Reserved) {
    return currentStatus;
  }
  const otherHold = await prisma.transaction.findFirst({
    where: {
      itemId,
      ...(excludeTxId ? { id: { not: excludeTxId } } : {}),
      status: { in: ['Active', 'Overdue', 'Reserved'] },
    },
    select: { status: true },
  });
  const next = !otherHold
    ? ItemStatus.Available
    : otherHold.status === 'Reserved' ? ItemStatus.Reserved : ItemStatus.Rented;
  if (next === currentStatus) return currentStatus;
  await prisma.inventoryItem.update({
    where: { id: itemId },
    data: { status: next, ...(next === ItemStatus.Available ? { outOfServiceReason: null } : {}) },
  });
  return next;
}

export async function cancelTransaction(transactionId: string, performedById: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { item: true },
  });
  if (!tx) throw new AppError(404, 'Transaction not found');
  if (tx.status === 'Returned') throw new AppError(400, 'Cannot cancel a returned transaction');
  if (tx.status === 'Cancelled') throw new AppError(400, 'Transaction already cancelled');

  await prisma.transaction.update({
    where: { id: transactionId },
    data: { status: TransactionStatus.Cancelled },
  });

  // Recompute the item's derived status instead of blindly freeing it: a
  // second live hold (e.g. a future reservation beside the active rental)
  // keeps the item out, and manual states (Cleaning batch, OutOfService
  // damage) are never touched by a cancellation.
  const itemStatus = await recomputeItemStatusAfterRelease(tx.itemId, transactionId, tx.item.status);

  // Tell the customer in-app (their bell + History tab). Best-effort so a
  // notification write can never break the cancellation itself; the email
  // below is best-effort too.
  try {
    await createNotification({
      profileId: tx.customerId,
      transactionId,
      type: 'booking_cancelled',
      title: 'Booking cancelled',
      message: `Your booking for ${tx.item.name} was cancelled and the item is back in the collection.`,
    });
  } catch (err) {
    console.error('[cancel] customer notification skipped:', (err as Error)?.message);
  }

  await createAuditLog({
    action: 'update',
    entity: 'transaction',
    entityId: transactionId,
    performedById,
    newValue: { status: 'Cancelled' },
    oldValue: { status: tx.status },
  });

  // Booking-cancelled email (Brevo, best-effort).
  try {
    const customerProfile = await prisma.profile.findUnique({ where: { id: tx.customerId } });
    const prefs = (customerProfile as { notifyPrefs?: Record<string, boolean> | null } | null)?.notifyPrefs;
    const wantsEmail = !prefs || prefs.email !== false;
    if (customerProfile?.email && wantsEmail) {
      await sendCancellationEmail(customerProfile.email, customerProfile.name, tx.item.name);
    }
  } catch { /* email is non-critical */ }

  clearDataCache();

  return { message: 'Transaction cancelled', itemId: tx.itemId, itemStatus };
}

export async function deleteTransaction(transactionId: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { item: true },
  });

  if (!tx) throw new AppError(404, 'Transaction not found');

  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { transactionId } }),
    prisma.notification.deleteMany({ where: { transactionId } }),
    prisma.sentSms.deleteMany({ where: { transactionId } }),
    prisma.transaction.delete({ where: { id: transactionId } }),
  ]);

  const nonReturnedStatuses = ['Active', 'Overdue', 'Reserved'];
  if (nonReturnedStatuses.includes(tx.status)) {
    // The row is already gone, so no exclusion is needed — recompute from
    // whatever live holds remain (and never touch Cleaning/OutOfService).
    await recomputeItemStatusAfterRelease(tx.itemId, null, tx.item.status);
  }

  clearDataCache();

  return { message: 'Transaction deleted' };
}

export async function releaseRental(
  transactionId: string,
  processedById: string,
  releasePhoto?: string,
  notes?: string,
  needsAlteration?: boolean
) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { item: true },
  });

  if (!tx) throw new AppError(404, 'Transaction not found');
  if (tx.status === TransactionStatus.Returned) throw new AppError(400, 'Transaction already returned');
  if (tx.status === TransactionStatus.Cancelled) throw new AppError(400, 'Transaction was cancelled');

  // A manual-QR booking whose transfer is still unverified must never be
  // prepared for pickup: the money may already be on its way, and collecting
  // it again at the counter would charge the customer twice.
  if (
    (tx.paymentPath === 'manual' || tx.gateway === 'manual') &&
    Number(tx.totalPaid) < Number(tx.downpayment)
  ) {
    throw new AppError(400, 'This booking is waiting on a manual QR payment proof — verify the transfer before preparing the pickup');
  }

  // No release until fully paid: the item leaves the shop only once the
  // rental balance (fee − amounts actually credited) is zero. Staff collect
  // it via Record Payment (counter cash or Online tab) — or in the release
  // sheet itself, which charges first and releases second.
  if (tx.balance > 0) {
    throw new AppError(400, `Collect the full payment of ₱${Number(tx.balance).toLocaleString()} before releasing`);
  }

  // Staff discovered the garment doesn't fit during release — flag it
  // immediately so the customer sees the pill and gets notified.
  const alterationPatch = needsAlteration === true
    ? { alterationStatus: 'pending' as string | null }
    : needsAlteration === false
      ? { alterationStatus: null as string | null }
      : {};

  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      // Releasing/picking up an item moves an upcoming hold (Reserved) into an
      // active rental (Active) and marks the item as Rented.
      status: TransactionStatus.Active,
      releasePhoto: releasePhoto ?? null,
      notes: notes ?? undefined,
      processedById,
      // Staff audit: who physically released the item. Set ONCE (first release
      // wins) so a re-release can't rewrite history; assistedBy is untouched.
      ...(tx.releasedById ? {} : { releasedById: processedById }),
      ...alterationPatch,
    },
    include: {
      assistedBy: { select: { id: true, name: true } },
      releasedBy: { select: { id: true, name: true } },
      processedBy: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, email: true, phone: true, address: true } },
      item: true,
    },
  });

  await prisma.inventoryItem.update({
    where: { id: tx.itemId },
    data: { status: ItemStatus.Rented },
  });

  // A re-release (photo retake / notes touch-up) must not log a second
  // "Item released" entry — otherwise the staff timeline shows a phantom
  // double release. First release wins; the audit logs it exactly once.
  if (!tx.releasedById) {
    await createAuditLog({
      action: 'update',
      entity: 'transaction',
      entityId: transactionId,
      performedById: processedById,
      newValue: { status: 'Active', released: true, releasedById: (updated as { releasedById?: string | null }).releasedById ?? null },
      oldValue: { status: tx.status },
    });
  }

  // Order-pickup email (Brevo, best-effort — the item is in the customer's hands).
  try {
    const customerProfile = await prisma.profile.findUnique({ where: { id: tx.customerId } });
    const prefs = (customerProfile as { notifyPrefs?: Record<string, boolean> | null } | null)?.notifyPrefs;
    const wantsEmail = !prefs || prefs.email !== false;
    if (customerProfile?.email && wantsEmail) {
      await sendPickupEmail(
        customerProfile.email,
        customerProfile.name,
        tx.item.name,
        updated.dueDate.toLocaleDateString('en-PH'),
      );
    }
  } catch { /* email is non-critical */ }

  // Staff flagged an alteration during release — notify the customer in-app
  // so they know to come back for fitting before using the garment.
  if (needsAlteration === true) {
    try {
      await createNotification({
        profileId: tx.customerId,
        transactionId,
        type: 'alteration_needed',
        title: 'Alteration needed',
        message: `Your "${tx.item.name}" needs fitting before pickup. The boutique will let you know when it's ready.`,
      });
    } catch { /* notification is non-critical */ }
  }

  clearDataCache();

  return updated;
}

// Staff activity timeline for one transaction: every audit_logs row for this
// transaction (create/release/return/edit/cancel) plus its payment records,
// oldest first, with the acting staff member's name resolved. Staff/Admin
// only (route-guarded); AuditLog has no profile relation, so names resolve
// via one profile query.
export async function getTransactionAudits(transactionId: string) {
  type ProofEvent = {
    id: string;
    action: string;
    entity: string;
    entityId: string;
    performedById: string | null;
    oldValue: unknown;
    newValue: Record<string, unknown>;
    createdAt: Date;
  };
  const [txLogs, payLogs, proofs] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity: 'transaction', entityId: transactionId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    prisma.auditLog.findMany({
      where: { entity: 'payment' },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    // Payment proofs carry their own submission + review timestamps, so the
    // timeline derives QR events here (not from audit logs) — every proof
    // shows up, including ones submitted before proof auditing existed.
    prisma.paymentProof.findMany({
      where: { transactionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        amount: true,
        reference: true,
        channel: true,
        rejectionReason: true,
        createdAt: true,
        reviewedAt: true,
        reviewedById: true,
        transaction: { select: { customerId: true } },
      },
    }),
  ]);
  const proofEvents: ProofEvent[] = proofs.flatMap((p) => {
    const newValue = { transactionId, amount: p.amount, reference: p.reference, channel: p.channel };
    const events: ProofEvent[] = [{
      id: `proof-submit-${p.id}`,
      action: 'payment_proof.submit',
      entity: 'payment_proof',
      entityId: p.id,
      performedById: p.transaction.customerId,
      oldValue: null,
      newValue,
      createdAt: p.createdAt,
    }];
    if (p.status === 'approved' || p.status === 'rejected') {
      events.push({
        id: `proof-${p.status}-${p.id}`,
        action: p.status === 'approved' ? 'payment_proof.approve' : 'payment_proof.reject',
        entity: 'payment_proof',
        entityId: p.id,
        performedById: p.reviewedById,
        oldValue: null,
        newValue: { ...newValue, reason: p.rejectionReason },
        createdAt: p.reviewedAt ?? p.createdAt,
      });
    }
    return events;
  });
  const logs = [
    ...txLogs,
    ...payLogs.filter(
      (l) => (l.newValue as { transactionId?: string } | null)?.transactionId === transactionId
    ),
    ...proofEvents,
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // Defense-in-depth: collapse repeat "released" entries to the FIRST one.
  // The release path now logs exactly once (first release wins), but legacy
  // rows with two releases would otherwise render a phantom double entry.
  const seenRelease = { done: false };
  const deduped = logs.filter((l) => {
    if ((l.newValue as { released?: boolean } | null)?.released === true) {
      if (seenRelease.done) return false;
      seenRelease.done = true;
    }
    return true;
  });
  const staffIds = [...new Set(deduped.map((l) => l.performedById).filter((id): id is string => !!id))];
  const staff = staffIds.length
    ? await prisma.profile.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true, role: true },
      })
    : [];
  const byId = new Map(staff.map((s) => [s.id, s]));
  return deduped.map((l) => ({
    id: l.id,
    action: l.action,
    entity: l.entity,
    oldValue: l.oldValue,
    newValue: l.newValue,
    createdAt: l.createdAt,
    performedBy: l.performedById ? (byId.get(l.performedById) ?? { id: l.performedById, name: 'Unknown staff', role: null }) : null,
  }));
}

export async function getUpcomingReturns() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const threeDaysFromNow = new Date(today);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  const transactions = await prisma.transaction.findMany({
    where: {
      status: { in: ['Active', 'Overdue'] },
      dueDate: { lte: threeDaysFromNow },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      item: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  return transactions;
}

export async function recordPayment(
  transactionId: string,
  staffId: string,
  amount: number,
  method: string,
  notes?: string,
) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { payments: true },
  });
  if (!tx) throw new AppError(404, 'Transaction not found');
  // Cancelled is terminal. Returned stays payable: a damaged return can leave
  // a damage-fee balance that the customer settles after the item is back.
  if (tx.status === 'Cancelled') {
    throw new AppError(400, 'Transaction is already closed');
  }

  const validMethods = ['cash', 'gcash', 'card', 'instapay'];
  const normalizedMethod = method.toLowerCase().trim();
  if (!validMethods.includes(normalizedMethod)) {
    throw new AppError(400, `Invalid payment method. Must be one of: ${validMethods.join(', ')}`);
  }

  const due = Math.max(0, tx.rentalFee + tx.latePenalty + tx.damageFee - tx.totalPaid);
  if (due <= 0) throw new AppError(400, 'Transaction is already fully paid');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(400, 'Payment amount must be greater than 0');
  }
  if (amount > due) {
    throw new AppError(400, `Payment amount exceeds outstanding balance of ₱${due.toLocaleString()}`);
  }

  const newTotalPaid = tx.totalPaid + amount;
  const newBalance = Math.max(0, tx.rentalFee + tx.latePenalty + tx.damageFee - newTotalPaid);

  const [payment] = await prisma.$transaction([
    prisma.payment.create({
      data: {
        transactionId,
        amount,
        method: normalizedMethod,
        type: newBalance <= 0 ? 'full' : 'partial',
        status: 'completed',
      },
    }),
    prisma.transaction.update({
      where: { id: transactionId },
      data: { totalPaid: newTotalPaid, balance: newBalance },
    }),
  ]);

  await createAuditLog({
    action: 'create',
    entity: 'payment',
    entityId: payment.id,
    performedById: staffId,
    newValue: { transactionId, amount, method: normalizedMethod },
  });

  clearDataCache();

  return { payment, totalPaid: newTotalPaid, balance: newBalance };
}



