import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { sendSms, applyTemplate } from './semaphore.service.js';
import { notifyStaffMembers } from './notifications.service.js';
import { getBusinessRules } from './settings.service.js';

export async function sendManualSms(params: {
  profileId: string;
  message: string;
  sentById: string;
  templateId?: string;
  transactionId?: string;
}) {
  const profile = await prisma.profile.findUnique({ where: { id: params.profileId } });
  if (!profile) throw new AppError(404, 'Profile not found');
  if (!profile.phone) throw new AppError(400, 'Profile has no phone number');

  let message = params.message;

  if (params.templateId) {
    const template = await prisma.smsTemplate.findUnique({ where: { id: params.templateId } });
    if (!template) throw new AppError(404, 'SMS template not found');
    message = template.content;
  }

  if (params.transactionId) {
    const tx = await prisma.transaction.findUnique({
      where: { id: params.transactionId },
      include: { item: true, customer: true },
    });
    if (tx) {
      message = applyTemplate(message, {
        customer: tx.customer.name,
        item: tx.item.name,
        date: tx.dueDate.toLocaleDateString('en-PH'),
        days: String(Math.max(1, Math.ceil((new Date().getTime() - tx.dueDate.getTime()) / (1000 * 60 * 60 * 24)))),
      });
    }
  }

  const smsResult = await sendSms(profile.phone, message);

  const sentSms = await prisma.sentSms.create({
    data: {
      profileId: params.profileId,
      sentById: params.sentById,
      transactionId: params.transactionId ?? null,
      templateId: params.templateId ?? null,
      message,
      status: smsResult.messageId ? 'sent' : 'queued',
    },
  });

  return sentSms;
}

export async function autoNotifyOverdue() {
  const now = new Date();

  const overdueTxs = await prisma.transaction.findMany({
    where: {
      status: 'Active',
      dueDate: { lt: now },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      item: { select: { id: true, name: true } },
    },
  });

  if (overdueTxs.length === 0) return [];

  const template = await prisma.smsTemplate.findFirst({
    where: { name: 'late_return' },
  });

  const results: { transactionId: string; customerName: string; message: string; status: string }[] = [];

  for (const tx of overdueTxs) {
    if (!tx.customer.phone) continue;

    let message = template?.content ?? 'Hi {customer}, your rental of {item} is now overdue ({days} day(s)). Please return immediately.';

    const daysOverdue = Math.max(1, Math.ceil((now.getTime() - tx.dueDate.getTime()) / (1000 * 60 * 60 * 24)));

    message = applyTemplate(message, {
      customer: tx.customer.name,
      item: tx.item.name,
      date: tx.dueDate.toLocaleDateString('en-PH'),
      days: String(daysOverdue),
    });

    try {
      const smsResult = await sendSms(tx.customer.phone, message);

      await prisma.sentSms.create({
        data: {
          profileId: tx.customer.id,
          transactionId: tx.id,
          templateId: template?.id ?? null,
          message,
          status: smsResult.messageId ? 'sent' : 'queued',
        },
      });

      results.push({
        transactionId: tx.id,
        customerName: tx.customer.name,
        message,
        status: smsResult.messageId ? 'sent' : 'queued',
      });
    } catch {
      results.push({
        transactionId: tx.id,
        customerName: tx.customer.name,
        message,
        status: 'failed',
      });
    }

    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: 'Overdue' },
    });

    // Staff alert: transaction became overdue.
    try {
      await notifyStaffMembers({
        transactionId: tx.id,
        type: 'overdue',
        title: 'Overdue Return',
        message: `"${tx.item.name}" rented by ${tx.customer.name} is now ${daysOverdue} day(s) overdue.`,
      });
    } catch { /* notification is non-critical */ }
  }

  return results;
}

export async function notifyDueToday() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const dueToday = await prisma.transaction.findMany({
    where: {
      status: { in: ['Active', 'Overdue'] },
      dueDate: { gte: startOfToday, lt: endOfToday },
      dueReminderSent: false,
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      item: { select: { id: true, name: true } },
    },
  });

  if (dueToday.length === 0) return [];

  // Reuse existing due_reminder template + the configurable late fee so the
  // customer sees the penalty for returning late.
  const template = await prisma.smsTemplate.findFirst({ where: { name: 'due_reminder' } });
  let latePerDay = 500;
  try {
    const rules = await getBusinessRules();
    const raw = rules['late_fee_per_day'] ?? rules['late_penalty_per_day'];
    const parsed = raw != null ? parseFloat(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) latePerDay = parsed;
  } catch { /* keep default */ }

  const results: { transactionId: string; customerName: string; itemName: string; sent: boolean }[] = [];
  for (const tx of dueToday) {
    // Text the customer their due-today reminder (if they have a phone).
    let sent = false;
    if (tx.customer.phone) {
      const message = template?.content
        ? applyTemplate(template.content, {
            customer: tx.customer.name,
            item: tx.item.name,
            date: tx.dueDate.toLocaleDateString('en-PH'),
          }) + ` Late fee: ₱${latePerDay}/day.`
        : `Hi ${tx.customer.name}, your rental of ${tx.item.name} is due today (${tx.dueDate.toLocaleDateString('en-PH')}). Please return on time to avoid a ₱${latePerDay}/day late fee.`;

      try {
        const smsResult = await sendSms(tx.customer.phone, message);
        await prisma.sentSms.create({
          data: {
            profileId: tx.customer.id,
            transactionId: tx.id,
            templateId: template?.id ?? null,
            message,
            status: smsResult.messageId ? 'sent' : 'queued',
          },
        });
        await prisma.transaction.update({ where: { id: tx.id }, data: { dueReminderSent: true } });
        sent = true;
      } catch {
        // leave dueReminderSent false so the next tick retries the SMS
      }
    } else {
      // No phone on file: nothing to send, so don't keep retrying every minute.
      await prisma.transaction.update({ where: { id: tx.id }, data: { dueReminderSent: true } });
    }

    // Staff in-app alert (existing behavior).
    try {
      await notifyStaffMembers({
        transactionId: tx.id,
        type: 'due_today',
        title: 'Due Today',
        message: `"${tx.item.name}" rented by ${tx.customer.name} is due today.`,
      });
    } catch { /* notification is non-critical */ }

    results.push({ transactionId: tx.id, customerName: tx.customer.name, itemName: tx.item.name, sent });
  }
  return results;
}

// No-show detection: a Reserved transaction whose pickup (rentalDate) passed
// more than NO_SHOW_WINDOW_DAYS ago with no release/condition photo means the
// customer never picked the item up. Staff get ONE alert per transaction
// (noShowNotified once-guard) so they can cancel and free the item.
const NO_SHOW_WINDOW_DAYS = 1;

export async function checkNoShowAndNotify() {
  const cutoff = new Date(Date.now() - NO_SHOW_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const noShowTxs = await prisma.transaction.findMany({
    where: {
      status: 'Reserved',
      rentalDate: { lt: cutoff },
      noShowNotified: false,
      releasePhoto: null,
      conditionPhoto: null,
    },
    include: {
      customer: { select: { id: true, name: true } },
      item: { select: { id: true, name: true } },
    },
  });

  if (noShowTxs.length === 0) return [];

  const results: { transactionId: string; customerName: string; itemName: string }[] = [];

  for (const tx of noShowTxs) {
    try {
      await notifyStaffMembers({
        transactionId: tx.id,
        type: 'no_show',
        title: 'No-Show Pickup',
        message: `${tx.customer.name} didn't pick up "${tx.item.name}" (reserved for ${tx.rentalDate.toLocaleDateString('en-PH')}). Cancel the booking?`,
      });
      await prisma.transaction.update({ where: { id: tx.id }, data: { noShowNotified: true } });
      results.push({ transactionId: tx.id, customerName: tx.customer.name, itemName: tx.item.name });
    } catch {
      // leave noShowNotified false so the next tick retries the notification
    }
  }

  return results;
}

export async function getSmsHistory(params: { limit?: number; offset?: number }) {  return prisma.sentSms.findMany({
    include: {
      profile: { select: { id: true, name: true, phone: true } },
      sentBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: params.limit || 50,
    skip: params.offset || 0,
  });
}
