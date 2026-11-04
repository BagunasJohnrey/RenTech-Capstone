import { prisma } from '../config/database.js';
import type { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { sendSms, applyTemplate, smsShortName, smsItemName, finalizeSms } from './semaphore.service.js';
import { sendDueReminderEmail, sendOverdueEmail } from './resend.service.js';
import { notifyStaffMembers } from './notifications.service.js';
import { getBusinessRules, isSmsEnabled, reminderWindowFrom, numberRule, getNumberRules } from './settings.service.js';
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

// Overdue notification policy (admin-configurable — Settings → Notifications):
//  - The day after the due date a rental flips to Overdue, staff get an
//    in-app alert, and the customer gets the first overdue SMS + email.
//  - Each channel then repeats every `overdue_{sms,email}_interval_days`
//    store-calendar days, up to `overdue_{sms,email}_max_count` notices.
//    Bookkeeping is per channel: overdueSmsCount/LastAt and
//    overdueEmailCount/LastAt. A count only moves on a real send, so a failed
//    SMS retries next tick while a delivered email never re-sends early
//    (coupling the two once caused a every-60s duplicate email flood).
//  - From `overdue_escalation_days` on, the wording asks the customer to call.
//  - From `overdue_manual_call_days` on, ALL automatic SMS/email stop and
//    staff/admin get ONE "please call" prompt (manualCallPromptedAt); the
//    rental shows in Tasks → Needs a call until someone marks it called.
//  - Quiet hours hold customer messages (counts untouched); the status flip
//    and staff alerts still happen overnight.
// Message text carries the outstanding rental balance (ASCII "PHP 1,250")
// but NEVER per-day late-fee/penalty rates or the ₱ glyph (non-GSM-7).

// PHP-notation amounts use plain ASCII "PHP 1,250" — the ₱ glyph is not
// GSM-7 and a single one flips the whole SMS into 70-char Unicode mode,
// doubling its segment cost. Templates carry the "PHP " prefix; this var is
// just the grouped number.
export function formatPhpAmount(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
}

// Scheduler bookkeeping (counts / retry markers) is invisible to staff, so it
// must not move Transaction.updatedAt: the staff freshness poll
// (GET /dashboard/version = max updatedAt) would otherwise show "New data
// available" every time a reminder fired, with nothing new on screen.
// Explicitly writing the row's current updatedAt overrides Prisma's
// @updatedAt bump. Real changes (status flip, manual-call prompt) still bump.
async function markScheduled(tx: { id: string; updatedAt?: Date }, data: Prisma.TransactionUpdateInput) {
  await prisma.transaction.update({ where: { id: tx.id }, data: { ...data, updatedAt: tx.updatedAt } });
}

const OVERDUE_TEMPLATE_FALLBACK = 'Hi {customer}, your {item} is overdue ({days} day(s)). Balance: PHP {balance}. Thank you! Automated message - do not reply.';
const DAY_MS = 24 * 60 * 60 * 1000;

// Whole store-calendar days between two instants (0 = same Manila day).
function manilaDaysBetween(from: Date, to: Date): number {
  return Math.round((manilaDayStart(to).getTime() - manilaDayStart(from).getTime()) / DAY_MS);
}

export interface OverdueSchedule {
  smsInterval: number;
  smsMax: number;
  emailInterval: number;
  emailMax: number;
  escalationDays: number;
  manualCallDays: number;
}

export function overdueScheduleFrom(rules: Record<string, string | undefined>): OverdueSchedule {
  return {
    smsInterval: numberRule(rules, 'overdue_sms_interval_days'),
    smsMax: numberRule(rules, 'overdue_sms_max_count'),
    emailInterval: numberRule(rules, 'overdue_email_interval_days'),
    emailMax: numberRule(rules, 'overdue_email_max_count'),
    escalationDays: numberRule(rules, 'overdue_escalation_days'),
    manualCallDays: numberRule(rules, 'overdue_manual_call_days'),
  };
}

// Is the next notice on this channel due? `count`/`lastAt` come from the
// row; rows written before the counters existed fall back to the old
// once-guards (sent + escalation flags) with the row's updatedAt as "last".
export function channelNoticeDue(
  count: number,
  lastAt: Date | null,
  interval: number,
  max: number,
  now: Date,
): boolean {
  if (count >= max) return false;
  if (count === 0 || !lastAt) return true;
  return manilaDaysBetween(lastAt, now) >= interval;
}

type OverdueRow = {
  id: string;
  status: string;
  dueDate: Date;
  updatedAt?: Date;
  balance: number;
  overdueSmsSent?: boolean;
  overdueSmsRetried?: boolean;
  overdueEscalationSent?: boolean;
  overdueEmailSent?: boolean;
  overdueEscalationEmailSent?: boolean;
  overdueSmsCount?: number | null;
  overdueSmsLastAt?: Date | null;
  overdueEmailCount?: number | null;
  overdueEmailLastAt?: Date | null;
  manualCallPromptedAt?: Date | null;
  customer: { id: string; name: string; email?: string | null; phone?: string | null; notifyPrefs?: unknown };
  item: { id: number; name: string };
};

function channelState(tx: OverdueRow, channel: 'sms' | 'email', now: Date) {
  const count = channel === 'sms' ? tx.overdueSmsCount : tx.overdueEmailCount;
  const lastAt = channel === 'sms' ? tx.overdueSmsLastAt : tx.overdueEmailLastAt;
  const legacy = channel === 'sms'
    ? Number(!!tx.overdueSmsSent) + Number(!!tx.overdueEscalationSent)
    : Number(!!tx.overdueEmailSent) + Number(!!tx.overdueEscalationEmailSent);
  const n = Math.max(Number(count) || 0, legacy);
  // A legacy-flagged row with no timestamp counts as "just sent": the next
  // repeat waits a full interval instead of firing immediately.
  return { count: n, lastAt: lastAt ?? (n > 0 ? tx.updatedAt ?? now : null) };
}

export async function autoNotifyOverdue(now: Date = new Date()) {
  // Overdue = the due DATE has passed on the store calendar. Comparing against
  // `now` flagged rentals "overdue (1 day)" at 08:00 on their own due date
  // (dates are stored as UTC midnight) — alongside the due-today reminder.
  // Rentals already handed to staff for a manual call are done here.
  const overdueTxs = (await prisma.transaction.findMany({
    where: {
      status: { in: ['Active', 'Overdue'] },
      dueDate: { lt: manilaDayStart(now) },
      manualCallPromptedAt: null,
    },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, notifyPrefs: true } },
      item: { select: { id: true, name: true } },
    },
  })) as unknown as OverdueRow[];

  if (overdueTxs.length === 0) return [];

  let rules: Record<string, string> = {};
  try { rules = await getBusinessRules(); } catch { /* defaults */ }
  const schedule = overdueScheduleFrom(rules);
  const quiet = isReminderQuietHours(now, reminderWindowFrom(rules));
  const template = await prisma.smsTemplate.findFirst({ where: { name: 'late_return' } });
  const smsGloballyOn = await isSmsEnabled().catch(() => true);

  const results: { transactionId: string; customerName: string; message: string; status: string }[] = [];
  let dashboardChanged = false;

  for (const tx of overdueTxs) {
    const daysOverdue = Math.max(1, manilaDaysPastDue(tx.dueDate, now));

    // Always flip to Overdue status even if SMS fails (status ≠ delivery flag),
    // but skip the no-op write: Prisma bumps updatedAt, which the staff
    // freshness poll would report as a change on every retry tick.
    let flipped = false;
    if (tx.status !== 'Overdue') {
      const updated = await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'Overdue' } });
      // Carry the bumped timestamp so the bookkeeping writes don't rewind it.
      if (updated?.updatedAt) tx.updatedAt = updated.updatedAt;
      flipped = true;
      dashboardChanged = true;
    }

    // Staff alert once per rental (notifyStaffMembers dedupes by tx + type);
    // only attempted on the first pass so later ticks skip the dedupe query.
    if (flipped || !tx.overdueSmsSent) {
      try {
        await notifyStaffMembers({
          transactionId: tx.id,
          type: 'overdue',
          title: 'Overdue Return',
          message: `"${tx.item.name}" rented by ${tx.customer.name} is now ${daysOverdue} day(s) overdue.`,
        });
      } catch { /* notification is non-critical */ }
    }

    // Manual-call cutoff: stop automatic reminders, prompt staff ONCE.
    if (daysOverdue >= schedule.manualCallDays) {
      try {
        const phone = tx.customer.phone ? ` at ${tx.customer.phone}` : '';
        await notifyStaffMembers({
          transactionId: tx.id,
          type: 'overdue_manual_call',
          title: 'Call customer',
          message: `${tx.customer.name} is ${daysOverdue} days overdue with "${tx.item.name}". Automatic reminders have stopped — please call${phone}.`,
        });
        // A real staff-visible change (Needs a call list) — let updatedAt move.
        await prisma.transaction.update({ where: { id: tx.id }, data: { manualCallPromptedAt: now } });
        dashboardChanged = true;
      } catch { /* retry next tick */ }
      results.push({ transactionId: tx.id, customerName: tx.customer.name, message: '', status: 'manual_call' });
      continue;
    }

    // Overnight the status flip + staff alerts still happen, but customer
    // SMS/email wait for the send window (counts untouched).
    if (quiet) continue;

    // Respect customer opt-out (notifyPrefs.lateReturn === false → skip SMS,
    // still notify staff). A null/undefined pref means "on" (default).
    // The global kill-switch ANDs on top.
    const prefs = tx.customer.notifyPrefs as Record<string, boolean> | null | undefined;
    const wantsSms = smsGloballyOn && (!prefs || prefs.lateReturn !== false);
    const wantsEmail = !prefs || (prefs.email !== false && prefs.lateReturn !== false);
    const escalated = daysOverdue >= schedule.escalationDays;

    // ---- Email channel ----
    const email = channelState(tx, 'email', now);
    if (tx.customer.email && wantsEmail
        && channelNoticeDue(email.count, email.lastAt, schedule.emailInterval, schedule.emailMax, now)) {
      try {
        const emailResult = await sendOverdueEmail(tx.customer.email, tx.customer.name, tx.item.name, daysOverdue);
        if (emailResult) {
          await markScheduled(tx, {
            overdueEmailCount: email.count + 1,
            overdueEmailLastAt: now,
            overdueEmailSent: true,
            ...(escalated ? { overdueEscalationEmailSent: true } : {}),
          });
        }
        // Null (disabled/failed send) leaves the count alone: nothing was
        // delivered, so retrying next tick is harmless.
      } catch { /* email is non-critical */ }
    }

    // ---- SMS channel ----
    const sms = channelState(tx, 'sms', now);
    if (!channelNoticeDue(sms.count, sms.lastAt, schedule.smsInterval, schedule.smsMax, now)) continue;

    if (!tx.customer.phone || !wantsSms) {
      // Nothing to send (no phone / opted out / SMS off). Mark the first
      // notice handled once so it's reported once, not every tick.
      if (!tx.overdueSmsSent) {
        await markScheduled(tx, { overdueSmsSent: true });
        results.push({ transactionId: tx.id, customerName: tx.customer.name, message: '', status: 'skipped' });
      }
      continue;
    }

    const message = escalated
      ? finalizeSms(`Hi ${smsShortName(tx.customer.name)}, ${smsItemName(tx.item.name)} is ${daysOverdue} day(s) overdue. Balance: PHP ${formatPhpAmount(tx.balance)}. Please call us. Thank you!`)
      : finalizeSms(applyTemplate(template?.content ?? OVERDUE_TEMPLATE_FALLBACK, {
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
          templateId: escalated ? null : template?.id ?? null,
          message,
          status: smsResult.messageId ? 'sent' : 'queued',
        },
      });
      await markScheduled(tx, {
        overdueSmsCount: sms.count + 1,
        overdueSmsLastAt: now,
        overdueSmsSent: true,
        ...(escalated ? { overdueEscalationSent: true } : {}),
      });
      dashboardChanged = true;
      results.push({ transactionId: tx.id, customerName: tx.customer.name, message, status: smsResult.messageId ? 'sent' : 'queued' });
    } catch {
      // Send failed: the count stays put so the next tick retries. Record the
      // retry once (observability) — rewriting it every failed tick would
      // churn the row for nothing.
      if (!tx.overdueSmsRetried) {
        await markScheduled(tx, { overdueSmsRetried: true });
      }
      results.push({ transactionId: tx.id, customerName: tx.customer.name, message, status: 'failed' });
    }
  }

  // A failed send changes nothing the dashboards show and retries every
  // tick, so it must NOT clear the cache (that re-ran the whole dashboard
  // warmer every minute for as long as one bad number kept failing).
  if (dashboardChanged || results.some((r) => r.status === 'skipped')) clearDataCache();

  return results;
}

// Due reminder: `due_reminder_lead_days` before the due date (0 = on the day).
// One SMS + one email per rental, each with its own once-guard.
export async function notifyDueToday(now: Date = new Date()) {
  let rules: Record<string, string> = {};
  try { rules = await getBusinessRules(); } catch { /* defaults */ }
  if (isReminderQuietHours(now, reminderWindowFrom(rules))) return [];
  const leadDays = numberRule(rules, 'due_reminder_lead_days');
  const startOfToday = manilaDayStart(now);
  // Window: due today … due `leadDays` from today. A rental booked inside the
  // lead window still gets its reminder (on the first eligible tick).
  const windowEnd = new Date(manilaNextDayStart(now).getTime() + leadDays * DAY_MS);

  const dueSoon = await prisma.transaction.findMany({
    where: {
      status: { in: ['Active', 'Overdue'] },
      dueDate: { gte: startOfToday, lt: windowEnd },
      dueReminderSent: false,
    },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, notifyPrefs: true } },
      item: { select: { id: true, name: true } },
    },
  });

  if (dueSoon.length === 0) return [];

  // Deliberately carries NO late-fee amount — reminder text stays fee-free.
  const template = await prisma.smsTemplate.findFirst({ where: { name: 'due_reminder' } });
  const smsGloballyOn = await isSmsEnabled().catch(() => true);

  const results: { transactionId: string; customerName: string; itemName: string; sent: boolean }[] = [];
  for (const tx of dueSoon) {
    const daysUntilDue = Math.max(0, -manilaDaysPastDue(tx.dueDate, now));
    const dueLabel = formatManilaDate(tx.dueDate);
    let sent = false;
    const prefs = (tx.customer as { notifyPrefs?: Record<string, boolean> | null }).notifyPrefs;
    const wantsSms = smsGloballyOn && (!prefs || prefs.reminder !== false);
    const wantsEmail = !prefs || (prefs.email !== false && prefs.reminder !== false);

    // Own once-guard (dueReminderEmailSent): an SMS failure leaves
    // dueReminderSent false for retry, which must not re-send the email.
    if (tx.customer.email && wantsEmail && !tx.dueReminderEmailSent) {
      try {
        const emailResult = await sendDueReminderEmail(tx.customer.email, tx.customer.name, tx.item.name, dueLabel, daysUntilDue);
        if (emailResult) {
          await markScheduled(tx, { dueReminderEmailSent: true });
        }
      } catch { /* email is non-critical */ }
    }
    if (tx.customer.phone && wantsSms) {
      const when = daysUntilDue === 0 ? 'today' : daysUntilDue === 1 ? 'tomorrow' : `on ${dueLabel}`;
      const message = finalizeSms(template?.content
        ? applyTemplate(template.content, {
            customer: smsShortName(tx.customer.name),
            item: smsItemName(tx.item.name),
            date: dueLabel,
          })
        : `Hi ${smsShortName(tx.customer.name)}, your ${smsItemName(tx.item.name)} rental is due ${when} (${dueLabel}). Thank you!`);

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
      // No phone / opted out: nothing to send, so don't keep retrying.
      await markScheduled(tx, { dueReminderSent: true });
    }

    // Staff in-app alert, worded for the actual day.
    try {
      await notifyStaffMembers({
        transactionId: tx.id,
        type: 'due_today',
        title: daysUntilDue === 0 ? 'Due Today' : 'Due Soon',
        message: daysUntilDue === 0
          ? `"${tx.item.name}" rented by ${tx.customer.name} is due today.`
          : `"${tx.item.name}" rented by ${tx.customer.name} is due ${daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`} (${dueLabel}).`,
      });
    } catch { /* notification is non-critical */ }

    results.push({ transactionId: tx.id, customerName: tx.customer.name, itemName: tx.item.name, sent });
  }
  if (results.length > 0) clearDataCache();
  return results;
}

// Staff/admin record that they phoned an overdue customer (Tasks → Needs a
// call). Clears the rental from the list; the note + caller are audited.
export async function markManualCall(transactionId: string, performedById: string, note?: string) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, status: true, manualCallPromptedAt: true, manualCalledAt: true },
  });
  if (!tx) throw new AppError(404, 'Transaction not found');
  if (tx.status === 'Returned' || tx.status === 'Cancelled') {
    throw new AppError(400, 'This rental is already closed');
  }
  const cleanNote = note?.trim() ? note.trim().slice(0, 500) : null;
  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: { manualCalledAt: new Date(), manualCalledById: performedById, manualCallNote: cleanNote },
  });
  try {
    await createAuditLog({
      action: 'transaction.manual_call', entity: 'transaction', entityId: transactionId,
      performedById,
      oldValue: { manualCalledAt: tx.manualCalledAt ?? null },
      newValue: { manualCalledAt: updated.manualCalledAt, note: cleanNote },
    });
  } catch { /* audit is non-critical */ }
  clearDataCache();
  return updated;
}

// No-show detection: a Reserved transaction whose pickup (rentalDate) passed
// more than `no_show_after_days` (admin setting, default 1) ago with no
// release/condition photo means the customer never picked the item up. Staff
// get ONE alert per transaction (noShowNotified once-guard) so they can
// cancel and free the item.
export async function checkNoShowAndNotify() {
  const { no_show_after_days: noShowDays } = await getNumberRules('no_show_after_days');
  const cutoff = new Date(Date.now() - noShowDays * 24 * 60 * 60 * 1000);

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
