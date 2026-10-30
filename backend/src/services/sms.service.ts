import { prisma } from '../config/database.js';
import type { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { sendSms, applyTemplate, smsShortName, smsItemName, finalizeSms } from './semaphore.service.js';
import { sendDueReminderEmail, sendOverdueEmail } from './brevo.service.js';
import { notifyStaffMembers } from './notifications.service.js';
import { getBusinessRules, isSmsEnabled } from './settings.service.js';
import { clearDataCache } from '../utils/ttlCache.js';
import {
  manilaDayStart, manilaNextDayStart, manilaDaysPastDue, isReminderQuietHours, formatManilaDate,
} from '../utils/manilaDay.js';

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
        customer: smsShortName(tx.customer.name),
        item: smsItemName(tx.item.name),
        date: formatManilaDate(tx.dueDate),
        days: String(Math.max(1, manilaDaysPastDue(tx.dueDate))),
        balance: formatPhpAmount(tx.balance),
      });
    }
  }

  message = finalizeSms(message);
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
//  - Reminder EMAILS have their own once-guards (overdueEmailSent /
//    overdueEscalationEmailSent / dueReminderEmailSent), flipped on send
//    independently of the SMS outcome. Gating email on the SMS flag meant any
//    transaction with a failing SMS (invalid phone, SMS outage) re-sent its
//    Brevo email every 60s tick indefinitely.
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

// Scheduler bookkeeping (once-guards / retry markers) is invisible to staff,
// so it must not move Transaction.updatedAt: the staff freshness poll
// (GET /dashboard/version = max updatedAt) would otherwise show "New data
// available" every time a reminder fired, with nothing new on screen.
// Explicitly writing the row's current updatedAt overrides Prisma's
// @updatedAt bump. Real changes (e.g. the status flip to Overdue) still bump.
async function markScheduled(tx: { id: string; updatedAt: Date }, data: Prisma.TransactionUpdateInput) {
  await prisma.transaction.update({ where: { id: tx.id }, data: { ...data, updatedAt: tx.updatedAt } });
}

const OVERDUE_TEMPLATE_FALLBACK = 'Hi {customer}, your {item} is overdue ({days} day(s)). Balance: PHP {balance}. Thank you! Automated message - do not reply.';

export async function autoNotifyOverdue(now: Date = new Date()) {
  // Overdue = the due DATE has passed on the store calendar. Comparing against
  // `now` flagged rentals "overdue (1 day)" at 08:00 on their own due date
  // (dates are stored as UTC midnight) — alongside the due-today reminder.
  const overdueTxs = await prisma.transaction.findMany({
    where: {
      status: { in: ['Active', 'Overdue'] },
      dueDate: { lt: manilaDayStart(now) },
      overdueSmsSent: false,
    },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, notifyPrefs: true } },
      item: { select: { id: true, name: true } },
    },
  });

  if (overdueTxs.length === 0) return [];

  const template = await prisma.smsTemplate.findFirst({ where: { name: 'late_return' } });
  const smsGloballyOn = await isSmsEnabled().catch(() => true);
  const quiet = isReminderQuietHours(now);

  const results: { transactionId: string; customerName: string; message: string; status: string }[] = [];
  let statusFlipped = false;

  for (const tx of overdueTxs) {
    const daysOverdue = Math.max(1, manilaDaysPastDue(tx.dueDate, now));

    // Always flip to Overdue status even if SMS fails (status ≠ delivery flag),
    // but skip the no-op write: Prisma bumps updatedAt, which the staff
    // freshness poll would report as a change on every retry tick.
    if (tx.status !== 'Overdue') {
      const flipped = await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'Overdue' } });
      // Carry the bumped timestamp so the flag writes below don't rewind it.
      if (flipped?.updatedAt) tx.updatedAt = flipped.updatedAt;
      statusFlipped = true;
    }

    // Overnight the status flip + staff alert still happen, but the customer
    // SMS/email wait for the morning (their once-guards stay false).
    if (quiet) {
      try {
        await notifyStaffMembers({
          transactionId: tx.id,
          type: 'overdue',
          title: 'Overdue Return',
          message: `"${tx.item.name}" rented by ${tx.customer.name} is now ${daysOverdue} day(s) overdue.`,
        });
      } catch { /* notification is non-critical */ }
      continue;
    }

    // Respect customer opt-out (notifyPrefs.lateReturn === false → skip SMS,
    // still notify staff). A null/undefined pref means "on" (default).
    // The global kill-switch ANDs on top: SMS OFF skips the text but the
    // status flip, email path, and staff alert below still run.
    const prefs = (tx.customer as { notifyPrefs?: Record<string, boolean> | null }).notifyPrefs;
    const wantsSms = smsGloballyOn && (!prefs || prefs.lateReturn !== false);
    // Email follows the same late-alert opt-out plus the master email switch.
    const wantsEmail = !prefs || (prefs.email !== false && prefs.lateReturn !== false);

    // Overdue email (Brevo, best-effort) — sent alongside the SMS path so the
    // customer gets the notice on both channels unless opted out. It carries
    // its OWN once-guard (overdueEmailSent): the SMS flag must stay false on
    // SMS failure so the text retries, but a delivered email must never
    // re-send — coupling the two caused a every-60s Brevo duplicate flood.
    if (tx.customer.email && wantsEmail && !tx.overdueEmailSent) {
      try {
        const emailResult = await sendOverdueEmail(tx.customer.email, tx.customer.name, tx.item.name, daysOverdue);
        if (emailResult) {
          await markScheduled(tx, { overdueEmailSent: true });
        }
        // Null (disabled/failed send) leaves the flag false: nothing was
        // delivered, so retrying next tick is harmless.
      } catch { /* email is non-critical */ }
    }

    if (!tx.customer.phone || !wantsSms) {
      // Nothing to send (no phone or opted out) — flag as done so we don't retry.
      await markScheduled(tx, { overdueSmsSent: true });
      results.push({ transactionId: tx.id, customerName: tx.customer.name, message: '', status: 'skipped' });
    } else {
      let message = template?.content ?? OVERDUE_TEMPLATE_FALLBACK;
      message = finalizeSms(applyTemplate(message, {
        customer: smsShortName(tx.customer.name),
        item: smsItemName(tx.item.name),
        date: formatManilaDate(tx.dueDate),
        days: String(daysOverdue),
        balance: formatPhpAmount(tx.balance),
      }));

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
        await markScheduled(tx, { overdueSmsSent: true });
        results.push({ transactionId: tx.id, customerName: tx.customer.name, message, status: smsResult.messageId ? 'sent' : 'queued' });
      } catch {
        // Send failed: leave overdueSmsSent FALSE so the next tick retries,
        // but record that a retry has been attempted (overdueSmsRetried) for
        // observability. The once-guard only flips on actual success.
        // Only write the flag once — rewriting it on every failed tick bumps
        // updatedAt and makes the freshness poll fire with nothing changed.
        if (!tx.overdueSmsRetried) {
          await markScheduled(tx, { overdueSmsRetried: true });
        }
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
  if (results.length > 0 || statusFlipped) clearDataCache();

  return results;
}

// Day-N escalation: rentals still overdue after `overdue_escalation_days` get a
// single follow-up text. Guarded by overdueEscalationSent so it fires once.
export async function notifyOverdue3Days(now: Date = new Date()) {
  if (isReminderQuietHours(now)) return [];

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
      // At least `escalationDays` store-calendar days past the due date.
      dueDate: { lt: new Date(manilaDayStart(now).getTime() - (escalationDays - 1) * 24 * 60 * 60 * 1000) },
    },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, notifyPrefs: true } },
      item: { select: { id: true, name: true } },
    },
  });

  if (txs.length === 0) return [];

  // Global kill-switch ANDs on top of the per-account opt-out (same shape
  // as autoNotifyOverdue: status/email/staff-alert paths still run).
  const smsGloballyOn = await isSmsEnabled().catch(() => true);
  const results: { transactionId: string; customerName: string; sent: boolean }[] = [];

  for (const tx of txs) {
    const daysOverdue = Math.max(escalationDays, manilaDaysPastDue(tx.dueDate, now));
    const prefs = (tx.customer as { notifyPrefs?: Record<string, boolean> | null }).notifyPrefs;
    const wantsSms = smsGloballyOn && (!prefs || prefs.lateReturn !== false);
    const wantsEmail = !prefs || (prefs.email !== false && prefs.lateReturn !== false);

    // Escalation email (Brevo, best-effort) alongside the SMS path. Own
    // once-guard (overdueEscalationEmailSent) — see autoNotifyOverdue: the SMS
    // flag staying false for retry must not drag the email along with it.
    if (tx.customer.email && wantsEmail && !tx.overdueEscalationEmailSent) {
      try {
        const emailResult = await sendOverdueEmail(tx.customer.email, tx.customer.name, tx.item.name, daysOverdue);
        if (emailResult) {
          await markScheduled(tx, { overdueEscalationEmailSent: true });
        }
      } catch { /* email is non-critical */ }
    }

    let sent = false;
    if (tx.customer.phone && wantsSms) {
      const message = finalizeSms(`Hi ${smsShortName(tx.customer.name)}, ${smsItemName(tx.item.name)} is ${daysOverdue} day(s) overdue. Balance: PHP ${formatPhpAmount(tx.balance)}. Please call us. Thank you!`);
      try {
        const smsResult = await sendSms(tx.customer.phone, message);
        await prisma.sentSms.create({
          data: { profileId: tx.customer.id, transactionId: tx.id, message, status: smsResult.messageId ? 'sent' : 'queued' },
        });
        sent = true;
      } catch {
        // failed: leave flag false to retry next tick
      }
    }

    if (sent || !tx.customer.phone || !wantsSms) {
      await markScheduled(tx, { overdueEscalationSent: true });
      results.push({ transactionId: tx.id, customerName: tx.customer.name, sent });
    }
  }

  // Escalation runs against Active rows too — a status flip to Overdue
  // changes dashboard KPIs, so refresh cached dashboard data.
  if (results.length > 0) clearDataCache();

  return results;
}

export async function notifyDueToday(now: Date = new Date()) {
  if (isReminderQuietHours(now)) return [];
  const startOfToday = manilaDayStart(now);
  const endOfToday = manilaNextDayStart(now);

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
  // Global kill-switch ANDs on top of the per-account opt-out.
  const smsGloballyOn = await isSmsEnabled().catch(() => true);

  const results: { transactionId: string; customerName: string; itemName: string; sent: boolean }[] = [];
  for (const tx of dueToday) {
    // Text the customer their due-today reminder (if they have a phone + opted in).
    let sent = false;
    const prefs = (tx.customer as { notifyPrefs?: Record<string, boolean> | null }).notifyPrefs;
    const wantsSms = smsGloballyOn && (!prefs || prefs.reminder !== false);
    const wantsEmail = !prefs || (prefs.email !== false && prefs.reminder !== false);

    // Due-today email (Brevo, best-effort) alongside the SMS path. Own
    // once-guard (dueReminderEmailSent): an SMS failure leaves dueReminderSent
    // false for retry, which must not re-send an already delivered email.
    if (tx.customer.email && wantsEmail && !tx.dueReminderEmailSent) {
      try {
        const emailResult = await sendDueReminderEmail(
          tx.customer.email,
          tx.customer.name,
          tx.item.name,
          formatManilaDate(tx.dueDate),
        );
        if (emailResult) {
          await markScheduled(tx, { dueReminderEmailSent: true });
        }
      } catch { /* email is non-critical */ }
    }
    if (tx.customer.phone && wantsSms) {
      const message = finalizeSms(template?.content
        ? applyTemplate(template.content, {
            customer: smsShortName(tx.customer.name),
            item: smsItemName(tx.item.name),
            date: formatManilaDate(tx.dueDate),
          })
        : `Hi ${smsShortName(tx.customer.name)}, your ${smsItemName(tx.item.name)} rental is due today (${formatManilaDate(tx.dueDate)}). Thank you!`);

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
        await markScheduled(tx, { dueReminderSent: true });
        sent = true;
      } catch {
        // leave dueReminderSent false so the next tick retries the SMS
      }
    } else {
      // No phone on file: nothing to send, so don't keep retrying every minute.
      await markScheduled(tx, { dueReminderSent: true });
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
        message: `${tx.customer.name} didn't pick up "${tx.item.name}" (reserved for ${formatManilaDate(tx.rentalDate)}). Cancel the booking?`,
      });
      await markScheduled(tx, { noShowNotified: true });
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

// Retry a logged send with the exact same recipient + message. The log is an
// append-only delivery record, so this INSERTS a fresh row instead of mutating
// the old one (the original `queued` row keeps telling the truth about that
// attempt). Staff-initiated, so it bypasses the global automatic-SMS switch —
// exactly like sendManualSms. Audited because it costs money and texts a
// customer again.
export async function resendSms(id: string, performedById: string) {
  const row = await prisma.sentSms.findUnique({
    where: { id },
    include: { profile: { select: { id: true, name: true, phone: true } } },
  });
  if (!row) throw new AppError(404, 'SMS record not found');
  if (!row.profile?.phone) throw new AppError(400, 'Profile has no phone number');

  const message = finalizeSms(row.message);
  const smsResult = await sendSms(row.profile.phone, message);

  const sentSms = await prisma.sentSms.create({
    data: {
      profileId: row.profileId,
      sentById: performedById,
      transactionId: row.transactionId ?? null,
      templateId: row.templateId ?? null,
      message,
      status: smsResult.messageId ? 'sent' : 'queued',
    },
  });

  try {
    const digits = String(row.profile.phone).replace(/\D/g, '');
    const maskedPhone = digits.length > 4 ? `***${digits.slice(-4)}` : '***';
    await createAuditLog({
      action: 'sms.resend', entity: 'sms', entityId: sentSms.id,
      performedById,
      newValue: {
        profileId: row.profileId, phone: maskedPhone, resentFromId: row.id,
        transactionId: row.transactionId ?? null, status: sentSms.status,
      },
    });
  } catch { /* audit is non-critical */ }

  return { ...sentSms, to: row.profile.phone, resentFromId: row.id };
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
