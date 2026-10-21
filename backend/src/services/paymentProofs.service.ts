import { prisma } from '../config/database.js';
import * as storageService from './storage.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { applyPaymentToTransaction } from './payments.ledger.js';
import { createNotification } from './notifications.service.js';
import { createAuditLog } from '../utils/audit.js';
import { clearDataCache, cacheOrCompute } from '../utils/ttlCache.js';
import { sendProofRejectedEmail, isSendableEmail } from './brevo.service.js';

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
  // The queue is cached like the dashboard digest; invalidate it now so the
  // staff Tasks page sees this (or a re-submitted) proof on its next load.
  clearDataCache();

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

export async function listProofQueue(limit = 50) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  // Same TTL cache as the today-digest: the Tasks page reads this on every
  // mount (and the priority card + queue each mount a hook), so repeat hits
  // must not re-run five pooler queries. All proof/booking mutations call
  // clearDataCache(), and the dashboard warmer refills this key in the
  // background, so a warm Tasks visit paints digest rows AND proof rows
  // together from one cached snapshot.
  return cacheOrCompute(`proof-queue:${take}`, () => listProofQueueUncached(take));
}

async function listProofQueueUncached(take: number) {
  const [pendingRows, pendingCount, reviewedRows, reviewedCount, manualTx] = await Promise.all([
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
    // Reviewed proofs are terminal (approved/rejected) — the staff history tab.
    prisma.paymentProof.findMany({
      where: { status: { in: ['approved', 'rejected'] } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        status: true,
        amount: true,
        reference: true,
        channel: true,
        imagePath: true,
        rejectionReason: true,
        reviewedAt: true,
        createdAt: true,
        reviewedBy: { select: { id: true, name: true } },
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
    prisma.paymentProof.count({ where: { status: { in: ['approved', 'rejected'] } } }),
    prisma.transaction.findMany({
      where: { paymentPath: 'manual', status: { in: ['Active', 'Reserved'] } },
      // Soonest pickup first — the chase list exists to unblock releases.
      orderBy: { rentalDate: 'asc' },
      take: 200,
      include: {
        item: { select: { name: true } },
        customer: { select: { id: true, name: true, phone: true, address: true } },
        paymentProofs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, rejectionReason: true, createdAt: true, reviewedAt: true },
        },
      },
    }),
  ]);

  const awaiting = manualTx
    .filter((t) => t.totalPaid < t.downpayment && t.paymentProofs[0]?.status !== 'pending')
    .map((t) => ({
      id: t.id, txNumber: t.txNumber, downpayment: t.downpayment, totalPaid: t.totalPaid,
      balance: t.balance, rentalDate: t.rentalDate, dueDate: t.dueDate,
      paymentPath: t.paymentPath,
      item: t.item, customer: t.customer, latestProof: t.paymentProofs[0] ?? null,
    }))
    .slice(0, take);

  return {
    pending: pendingRows,
    awaiting,
    reviewed: reviewedRows,
    counts: { pending: pendingCount, awaiting: awaiting.length, reviewed: reviewedCount },
  };
}

// Customer-facing history: every proof the signed-in customer has submitted,
// newest first, with the booking it belongs to. Scoped by customerId in the
// query so a customer can never read another customer's proofs.
export async function listCustomerProofs(customerId: string, limit = 50) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const proofs = await prisma.paymentProof.findMany({
    where: { transaction: { customerId } },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      status: true,
      amount: true,
      reference: true,
      channel: true,
      imagePath: true,
      rejectionReason: true,
      reviewedAt: true,
      createdAt: true,
      transaction: {
        select: {
          id: true,
          txNumber: true,
          status: true,
          item: { select: { name: true } },
        },
      },
    },
  });
  return { proofs };
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
  clearDataCache();

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
        select: {
          id: true, txNumber: true, customerId: true,
          item: { select: { name: true } },
          customer: { select: { name: true, email: true } },
        },
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
  clearDataCache();

  await createNotification({
    profileId: proof.transaction.customerId,
    transactionId: proof.transaction.id,
    type: 'payment_proof_rejected',
    title: 'Payment proof needs attention',
    message: `We couldn't verify your payment for ${proof.transaction.item?.name ?? 'your booking'}: ${reason}. You can upload a new proof from My Rentals.`,
  });

  // Email mirrors the in-app notification (best-effort; lifecycle emails honor
  // the admin kill-switch and skip walk-in @rentech.invalid addresses).
  const customer = proof.transaction.customer;
  if (isSendableEmail(customer?.email)) {
    await sendProofRejectedEmail(
      customer.email!,
      customer.name?.trim() || 'there',
      proof.transaction.item?.name ?? 'your booking',
      reason,
    );
  }

  await createAuditLog({
    action: 'payment_proof.reject',
    entity: 'payment_proof',
    entityId: proof.id,
    performedById: reviewerId,
    newValue: { transactionId: proof.transaction.id, reason },
  });

  return {
    proof: {
      id: proof.id, status: 'rejected', rejectionReason: reason, amount: proof.amount,
      reference: proof.reference, channel: proof.channel, createdAt: proof.createdAt,
    },
  };
}
