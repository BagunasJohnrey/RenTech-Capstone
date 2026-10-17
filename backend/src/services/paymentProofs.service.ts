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
