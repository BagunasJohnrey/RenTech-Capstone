import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { sendSms, applyTemplate } from './semaphore.service.js';
import { sendDueReminderEmail, sendOverdueEmail } from './brevo.service.js';
import { notifyStaffMembers } from './notifications.service.js';
import { getBusinessRules } from './settings.service.js';
import { clearDataCache } from '../utils/ttlCache.js';

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
        balance: formatPhpAmount(tx.balance),
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

  // Manual sends cost real money and contact customers: audit who sent what to
  // whom. The message body is excluded (PII); only the masked phone, template
  // and transaction refs are logged. Non-critical: never blocks the send.
  try {
    const digits = String(profile.phone ?? '').replace(/\D/g, '');
    const maskedPhone = digits.length > 4 ? `***${digits.slice(-4)}` : '***';
    await createAuditLog({
      action: 'sms.send', entity: 'sms', entityId: sentSms.id,
      performedById: params.sentById,
      newValue: {
        profileId: params.profileId, phone: maskedPhone,
        templateId: params.templateId ?? null, transactionId: params.transactionId ?? null,
        status: sentSms.status,
      },
    });
  } catch { /* audit is non-critical */ }

  return sentSms;
}

// Overdue notification policy:
//  - On the day a rental goes overdue we text the customer ONCE (overdueSmsSent
//    once-guard). If the send fails the flag stays false so the NEXT scheduler
//    tick retries — but once it succeeds we never double-send.
//  - After overdue_escalation_days (default 3) still-overdue rentals get ONE
//    escalation text (overdueEscalationSent once-guard).
//  - Customers with no phone are marked sent immediately (nothing to send) so
//    the scheduler doesn't retry every minute; staff still get the in-app alert.
// Message text carries the outstanding rental balance (ASCII "PHP 1,250")
// but NEVER per-day late-fee/penalty rates or the ₱ glyph (non-GSM-7).

// PHP-notation amounts use plain ASCII "PHP 1,250" — the ₱ glyph is not
// GSM-7 and a single one flips the whole SMS into 70-char Unicode mode,
// doubling its segment cost. Templates carry the "PHP " prefix; this var is
// just the grouped number.
export function formatPhpAmount(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
}

const OVERDUE_TEMPLATE_FALLBACK = 'Hi {customer}, your {item} rental is overdue ({days} day(s)). Balance: PHP {balance}. Please return soon. Thank you!';

export async function autoNotifyOverdue() {
  const now = new Date();

  const overdueTxs = await prisma.transaction.findMany({
    where: {
      status: { in: ['Active', 'Overdue'] },
      dueDate: { lt: now },
      overdueSmsSent: false,
    },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, notifyPrefs: true } },
      item: { select: { id: true, name: true } },
    },
  });

  if (overdueTxs.length === 0) return [];

  const template = await prisma.smsTemplate.findFirst({ where: { name: 'late_return' } });

  const results: { transactionId: string; customerName: string; message: string; status: string }[] = [];

  for (const tx of overdueTxs) {
    const daysOverdue = Math.max(1, Math.ceil((now.getTime() - tx.dueDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Always flip to Overdue status even if SMS fails (status ≠ delivery flag).
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'Overdue' } });

    // Respect customer opt-out (notifyPrefs.lateReturn === false → skip SMS,
    // still notify staff). A null/undefined pref means "on" (default).
    const prefs = (tx.customer as { notifyPrefs?: Record<string, boolean> | null }).notifyPrefs;
    const wantsSms = !prefs || prefs.lateReturn !== false;
    // Email follows the same late-alert opt-out plus the master email switch.
    const wantsEmail = !prefs || (prefs.email !== false && prefs.lateReturn !== false);

    // Overdue email (Brevo, best-effort) — sent alongside the SMS path so the
    // customer gets the notice on both channels unless opted out.
    if (tx.customer.email && wantsEmail) {
      try {
        await sendOverdueEmail(tx.customer.email, tx.customer.name, tx.item.name, daysOverdue);
      } catch { /* email is non-critical */ }
    }

    if (!tx.customer.phone || !wantsSms) {
      // Nothing to send (no phone or opted out) — flag as done so we don't retry.
      await prisma.transaction.update({ where: { id: tx.id }, data: { overdueSmsSent: true } });
      results.push({ transactionId: tx.id, customerName: tx.customer.name, message: '', status: 'skipped' });
    } else {
      let message = template?.content ?? OVERDUE_TEMPLATE_FALLBACK;
      message = applyTemplate(message, {
        customer: tx.customer.name,
        item: tx.item.name,
        date: tx.dueDate.toLocaleDateString('en-PH'),
        days: String(daysOverdue),
        balance: formatPhpAmount(tx.balance),
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
        // Mark SENT — once-guard. On success the scheduler won't retry.
        await prisma.transaction.update({ where: { id: tx.id }, data: { overdueSmsSent: true } });
        results.push({ transactionId: tx.id, customerName: tx.customer.name, message, status: smsResult.messageId ? 'sent' : 'queued' });
      } catch {
        // Send failed: leave overdueSmsSent FALSE so the next tick retries,
        // but record that a retry has been attempted (overdueSmsRetried) for
        // observability. The once-guard only flips on actual success.
        await prisma.transaction.update({ where: { id: tx.id }, data: { overdueSmsRetried: true } });
        results.push({ transactionId: tx.id, customerName: tx.customer.name, message, status: 'failed' });
      }
    }

    // Staff alert (independent of customer SMS delivery) — once per transaction.
    try {
      await notifyStaffMembers({
        transactionId: tx.id,
        type: 'overdue',
        title: 'Overdue Return',
        message: `"${tx.item.name}" rented by ${tx.customer.name} is now ${daysOverdue} day(s) overdue.`,
      });
    } catch { /* notification is non-critical */ }
  }

  // Overdue flags change dashboard KPIs — refresh cached dashboard data.
  if (results.length > 0) clearDataCache();

  return results;
}

// Day-N escalation: rentals still overdue after `overdue_escalation_days` get a
// single follow-up text. Guarded by overdueEscalationSent so it fires once.
export async function notifyOverdue3Days() {
  const now = new Date();

  let escalationDays = 3;
  try {
    const rules = await getBusinessRules();
    const raw = rules['overdue_escalation_days'];
    const parsed = raw != null ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) escalationDays = parsed;
  } catch { /* keep default */ }

  const txs = await prisma.transaction.findMany({
    where: {
      status: { in: ['Active', 'Overdue'] },
      overdueEscalationSent: false,
      dueDate: { lt: new Date(now.getTime() - (escalationDays - 1) * 24 * 60 * 60 * 1000) },
    },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, notifyPrefs: true } },
      item: { select: { id: true, name: true } },
    },
  });

  if (txs.length === 0) return [];

  const results: { transactionId: string; customerName: string; sent: boolean }[] = [];

  for (const tx of txs) {
    const daysOverdue = Math.max(escalationDays, Math.ceil((now.getTime() - tx.dueDate.getTime()) / (1000 * 60 * 60 * 24)));
    const prefs = (tx.customer as { notifyPrefs?: Record<string, boolean> | null }).notifyPrefs;
    const wantsSms = !prefs || prefs.lateReturn !== false;
    const wantsEmail = !prefs || (prefs.email !== false && prefs.lateReturn !== false);

    // Escalation email (Brevo, best-effort) alongside the SMS path.
    if (tx.customer.email && wantsEmail) {
      try {
        await sendOverdueEmail(tx.customer.email, tx.customer.name, tx.item.name, daysOverdue);
      } catch { /* email is non-critical */ }
    }

    let sent = false;
    if (tx.customer.phone && wantsSms) {
      const message = `Hi ${tx.customer.name}, your ${tx.item.name} rental is ${daysOverdue} day(s) overdue. Balance: PHP ${formatPhpAmount(tx.balance)}. Contact Mylene's Boutique.`;
      try {
        await sendSms(tx.customer.phone, message);
        await prisma.sentSms.create({
          data: { profileId: tx.customer.id, transactionId: tx.id, message, status: 'sent' },
        });
        sent = true;
      } catch {
        // failed: leave flag false to retry next tick
      }
    }

    if (sent || !tx.customer.phone || !wantsSms) {
      await prisma.transaction.update({ where: { id: tx.id }, data: { overdueEscalationSent: true } });
      results.push({ transactionId: tx.id, customerName: tx.customer.name, sent });
    }
  }

  // Escalation runs against Active rows too — a status flip to Overdue
  // changes dashboard KPIs, so refresh cached dashboard data.
  if (results.length > 0) clearDataCache();

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
      customer: { select: { id: true, name: true, email: true, phone: true, notifyPrefs: true } },
      item: { select: { id: true, name: true } },
    },
  });

  if (dueToday.length === 0) return [];

  // Due-today reminder. Deliberately carries NO late-fee amount — reminder text
  // must stay fee-free per the notification policy.
  const template = await prisma.smsTemplate.findFirst({ where: { name: 'due_reminder' } });

  const results: { transactionId: string; customerName: string; itemName: string; sent: boolean }[] = [];
  for (const tx of dueToday) {
    // Text the customer their due-today reminder (if they have a phone + opted in).
    let sent = false;
    const prefs = (tx.customer as { notifyPrefs?: Record<string, boolean> | null }).notifyPrefs;
    const wantsSms = !prefs || prefs.reminder !== false;
    const wantsEmail = !prefs || (prefs.email !== false && prefs.reminder !== false);

    // Due-today email (Brevo, best-effort) alongside the SMS path.
    if (tx.customer.email && wantsEmail) {
      try {
        await sendDueReminderEmail(
          tx.customer.email,
          tx.customer.name,
          tx.item.name,
          tx.dueDate.toLocaleDateString('en-PH'),
        );
      } catch { /* email is non-critical */ }
    }
    if (tx.customer.phone && wantsSms) {
      const message = template?.content
        ? applyTemplate(template.content, {
            customer: tx.customer.name,
            item: tx.item.name,
            date: tx.dueDate.toLocaleDateString('en-PH'),
          })
        : `Hi ${tx.customer.name}, a reminder that your rental of ${tx.item.name} is due today (${tx.dueDate.toLocaleDateString('en-PH')}). See you at the boutique!`;

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
  // Flag flips + new notification rows move the data version — refresh
  // cached dashboard data so the version fingerprint and lists agree.
  if (results.length > 0) clearDataCache();
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

  // New notification rows + flag flips move the data version too.
  if (results.length > 0) clearDataCache();

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

// Admin-only SMS log cleanup. Rows are delivery records (the message already
// left via Semaphore), so deleting only clears the log — it never unsends.
// Audited like manual sends; retention still purges old rows automatically.
export async function deleteSmsHistory(id: string, performedById: string) {
  const row = await prisma.sentSms.findUnique({ where: { id } });
  if (!row) throw new AppError(404, 'SMS record not found');
  await prisma.sentSms.delete({ where: { id } });
  try {
    await createAuditLog({
      action: 'sms.delete', entity: 'sms', entityId: id,
      performedById,
    });
  } catch { /* audit is non-critical */ }
  return { id };
}
