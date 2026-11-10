import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

// Egress: every scheduler job and many requests read the whole rules table
// (often several times per tick). Cache it briefly; every write path below
// (updateBusinessRules, backup restore) calls clearBusinessRulesCache().
const RULES_TTL_MS = 60_000;
let rulesCache: { at: number; map: Record<string, string> } | null = null;

export function clearBusinessRulesCache() {
  rulesCache = null;
}

export async function getBusinessRules() {
  if (rulesCache && Date.now() - rulesCache.at <= RULES_TTL_MS) return { ...rulesCache.map };
  const rules = await prisma.businessRule.findMany();
  const map: Record<string, string> = {};
  for (const rule of rules) {
    map[rule.key] = rule.value;
  }
  rulesCache = { at: Date.now(), map };
  return { ...map };
}

// Numeric business rules the admin can change in Settings. One table holds
// each rule's default and allowed range so the readers (fallback/clamp) and
// the save validation never disagree.
export const NUMERIC_RULES = {
  rental_period_days: { def: 3, min: 1, max: 30 },
  return_days_after_event: { def: 1, min: 0, max: 7 },
  min_downpayment: { def: 200, min: 0, max: 1_000_000 },
  damage_fee: { def: 1000, min: 0, max: 1_000_000 },
  overdue_escalation_days: { def: 3, min: 1, max: 30 },
  data_retention_months: { def: 12, min: 3, max: 60 },
  // Days an item is held for cleaning after a rental's due date before the
  // next pickup can start (blocks the calendar).
  cleaning_buffer_days: { def: 1, min: 0, max: 7 },
  // Reserved bookings not picked up this many days after the pickup date
  // raise a "no-show" alert to staff.
  no_show_after_days: { def: 1, min: 1, max: 14 },
  // Automatic customer SMS/email go out only between these Manila hours.
  reminder_send_start_hour: { def: 8, min: 0, max: 23 },
  reminder_send_end_hour: { def: 21, min: 1, max: 24 },
  // ---- Reminder schedule (client feedback §3.2–3.4) ----
  // Due reminder goes out this many days before the due date (0 = on the day).
  due_reminder_lead_days: { def: 0, min: 0, max: 7 },
  // Overdue notices: first one the day after the due date, then one every
  // N days per channel, up to the max count per channel.
  overdue_email_interval_days: { def: 2, min: 1, max: 14 },
  overdue_email_max_count: { def: 3, min: 1, max: 30 },
  overdue_sms_interval_days: { def: 2, min: 1, max: 14 },
  overdue_sms_max_count: { def: 3, min: 1, max: 30 },
  // From this many days overdue, automatic SMS + email stop and staff/admin
  // are prompted (once) to phone the customer instead.
  overdue_manual_call_days: { def: 10, min: 2, max: 60 },
} as const;
export type NumericRuleKey = keyof typeof NUMERIC_RULES;

// Parsed, range-clamped value with the default for missing/garbage input.
export function numberRule(rules: Record<string, string | undefined>, key: NumericRuleKey): number {
  const { def, min, max } = NUMERIC_RULES[key];
  const n = Number(rules[key]);
  if (rules[key] == null || rules[key] === '' || !Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

export async function getNumberRules(...keys: NumericRuleKey[]): Promise<Record<NumericRuleKey, number>> {
  let rules: Record<string, string> = {};
  try { rules = await getBusinessRules(); } catch { /* defaults */ }
  const out = {} as Record<NumericRuleKey, number>;
  for (const k of keys) out[k] = numberRule(rules, k);
  return out;
}

export interface ReminderWindow { startHour: number; endHour: number }
export function reminderWindowFrom(rules: Record<string, string | undefined>): ReminderWindow {
  const startHour = numberRule(rules, 'reminder_send_start_hour');
  const endHour = numberRule(rules, 'reminder_send_end_hour');
  // A saved window is validated start < end; guard old/odd rows anyway.
  if (startHour >= endHour) {
    return { startHour: NUMERIC_RULES.reminder_send_start_hour.def, endHour: NUMERIC_RULES.reminder_send_end_hour.def };
  }
  return { startHour, endHour };
}

export async function getReminderWindow(): Promise<ReminderWindow> {
  let rules: Record<string, string> = {};
  try { rules = await getBusinessRules(); } catch { /* defaults */ }
  return reminderWindowFrom(rules);
}

// Rejects out-of-range / non-numeric values for known numeric rules and an
// inverted reminder window. Unknown keys pass through (text settings).
export function assertValidRuleValues(data: Record<string, string>, current: Record<string, string> = {}) {
  for (const [key, raw] of Object.entries(data)) {
    if (/^(email|sms)_type_[a-z_]+_enabled$/.test(key) && raw !== 'true' && raw !== 'false') {
      throw new AppError(400, `${key} must be 'true' or 'false'`);
    }
    const spec =(NUMERIC_RULES as Record<string, { min: number; max: number }>)[key];
    if (!spec) continue;
    const n = Number(raw);
    if (String(raw).trim() === '' || !Number.isFinite(n)) {
      throw new AppError(400, `${key} must be a number`);
    }
    if (n < spec.min || n > spec.max) {
      throw new AppError(400, `${key} must be between ${spec.min} and ${spec.max}`);
    }
  }
  const start = Number(data.reminder_send_start_hour ?? current.reminder_send_start_hour ?? NUMERIC_RULES.reminder_send_start_hour.def);
  const end = Number(data.reminder_send_end_hour ?? current.reminder_send_end_hour ?? NUMERIC_RULES.reminder_send_end_hour.def);
  if (('reminder_send_start_hour' in data || 'reminder_send_end_hour' in data) && start >= end) {
    throw new AppError(400, 'Reminder start hour must be earlier than the end hour');
  }
}

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

// Public rental-suggestion defaults (never the full rules/templates) so
// booking flows can prefill sensibly without leaking sensitive settings.
// `payment_gateway` is always 'manual' — the boutique is paid through its
// static QR codes and each payment is reviewed by staff.
// Store contact fields (name/contact/address) are also public — they power the
// customer "Inquiries & Contact" card. The contact number is the fixed store
// inquiry number the admin sets in Settings → General → Business Profile.
export async function getRentalDefaults() {
  const rules = await getBusinessRules();
  return {
    rental_period_days: parseInt(rules.rental_period_days ?? '3', 10) || 3,
    return_days_after_event: parseInt(rules.return_days_after_event ?? '1', 10) || 1,
    min_downpayment: parseInt(rules.min_downpayment ?? '200', 10) || 0,
    payment_gateway: 'manual',
    manual_qr_codes: parseManualQrCodes(rules.manual_qr_codes),
    store_name: rules.business_name ?? '',
    store_contact: rules.business_contact ?? '',
    store_address: rules.business_address ?? '',
  };
}

// Non-sensitive feature flags derived from business rules. Booleans default
// to `true` (feature on) when the key has never been set.
export async function getFeatureFlags() {
  const rules = await getBusinessRules();
  return {
    qr_booking_codes: rules.qr_booking_codes !== 'false',
  };
}

// The only payment path is the boutique's static QR: customers upload a
// screenshot, staff verify it, and approval credits the booking. The legacy
// `payment_gateway` rule is kept for compatibility but deliberately ignored.
export async function getPaymentGateway(): Promise<'manual'> {
  return 'manual';
}

// Global messaging kill-switches (admin-controlled via BusinessRule).
// Absent key = ON (fail-open), so existing installs keep sending until an
// admin deliberately flips a switch off. Values are 'true'/'false' strings.
export const SMS_ENABLED_KEY = 'messaging_sms_enabled';
export const EMAIL_ENABLED_KEY = 'messaging_email_enabled';

async function isRuleEnabled(key: string): Promise<boolean> {
  try {
    const row = await prisma.businessRule.findUnique({ where: { key } });
    return row?.value !== 'false';
  } catch {
    return true;
  }
}

// Global Semaphore SMS switch — gates automatic scheduler/booking texts.
// Manual staff sends (sendManualSms) intentionally bypass this.
export async function isSmsEnabled(): Promise<boolean> {
  return isRuleEnabled(SMS_ENABLED_KEY);
}

// Global email switch — gates lifecycle/order emails sent through
// sendBestEffort. Auth emails (verification/reset) bypass this on purpose.
export async function isEmailEnabled(): Promise<boolean> {
  return isRuleEnabled(EMAIL_ENABLED_KEY);
}

// Per-type email toggles (Settings → Notifications). Absent key = ON. Read
// through the 60s rules cache: these are checked on every lifecycle send.
export const EMAIL_TYPES = ['booking', 'pickup', 'return', 'cancellation', 'payment', 'due_reminder', 'overdue'] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];
export const emailTypeKey = (type: EmailType) => `email_type_${type}_enabled`;

export async function isEmailTypeEnabled(type: EmailType): Promise<boolean> {
  try {
    const rules = await getBusinessRules();
    return rules[emailTypeKey(type)] !== 'false';
  } catch {
    return true;
  }
}

// Per-type automatic customer SMS toggles (Settings → Notifications →
// Customer SMS). They AND with the global `messaging_sms_enabled` switch and
// the customer's own notifyPrefs. Manual staff sends are never gated.
// Absent key = the type's default: existing texts default ON (no behaviour
// change on upgrade); the new payment-received text defaults OFF because
// every SMS costs money — an admin opts in.
export const SMS_TYPES = ['booking', 'payment', 'due_reminder', 'overdue'] as const;
export type SmsType = (typeof SMS_TYPES)[number];
export const SMS_TYPE_DEFAULTS: Record<SmsType, boolean> = {
  booking: true,
  payment: false,
  due_reminder: true,
  overdue: true,
};
export const smsTypeKey = (type: SmsType) => `sms_type_${type}_enabled`;

export function smsTypeEnabledFrom(rules: Record<string, string>, type: SmsType): boolean {
  const raw = rules[smsTypeKey(type)];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return SMS_TYPE_DEFAULTS[type];
}

export async function isSmsTypeEnabled(type: SmsType): Promise<boolean> {
  try {
    return smsTypeEnabledFrom(await getBusinessRules(), type);
  } catch {
    return SMS_TYPE_DEFAULTS[type];
  }
}

export async function updateBusinessRules(data: Record<string, string>) {
  const results: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const updated = await prisma.businessRule.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    results[updated.key] = updated.value;
  }
  clearBusinessRulesCache();
  return results;
}

export async function listSmsTemplates() {
  return prisma.smsTemplate.findMany({ orderBy: { name: 'asc' } });
}

export async function createSmsTemplate(data: { name: string; content: string; isDefault?: boolean }) {
  if (data.isDefault) {
    await prisma.smsTemplate.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }
  return prisma.smsTemplate.create({ data });
}

export async function updateSmsTemplate(id: string, data: { name?: string; content?: string; isDefault?: boolean }) {
  const existing = await prisma.smsTemplate.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'SMS template not found');

  if (data.isDefault) {
    await prisma.smsTemplate.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.smsTemplate.update({ where: { id }, data });
}

export async function deleteSmsTemplate(id: string) {
  const existing = await prisma.smsTemplate.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'SMS template not found');

  await prisma.smsTemplate.delete({ where: { id } });
  return { deleted: true };
}
