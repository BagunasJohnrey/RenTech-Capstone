import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

export async function getBusinessRules() {
  const rules = await prisma.businessRule.findMany();
  const map: Record<string, string> = {};
  for (const rule of rules) {
    map[rule.key] = rule.value;
  }
  return map;
}

// Public rental-suggestion defaults (never the full rules/templates) so
// booking flows can prefill sensibly without leaking sensitive settings.
// `payment_gateway` is included (not sensitive) so the booking form can render
// the right payment-method UI before create-intent reports the gateway.
// Store contact fields (name/contact/address) are also public — they power the
// customer "Inquiries & Contact" card. The contact number is the fixed store
// inquiry number the admin sets in Settings → General → Business Profile.
export async function getRentalDefaults() {
  const rules = await getBusinessRules();
  return {
    rental_period_days: parseInt(rules.rental_period_days ?? '3', 10) || 3,
    return_days_after_event: parseInt(rules.return_days_after_event ?? '1', 10) || 1,
    min_downpayment: parseInt(rules.min_downpayment ?? '200', 10) || 0,
    payment_gateway: rules.payment_gateway === 'maya' ? 'maya' : 'paymongo',
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

// Which payment gateway new charges use. Unknown or absent values fall back to
// 'paymongo' so a typo in the rule can't take the booking flow down.
export async function getPaymentGateway(): Promise<'paymongo' | 'maya'> {
  const rules = await getBusinessRules();
  return rules.payment_gateway === 'maya' ? 'maya' : 'paymongo';
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

// Global Brevo email switch — gates lifecycle/order emails sent through
// sendBestEffort. Auth emails (verification/reset) bypass this on purpose.
export async function isEmailEnabled(): Promise<boolean> {
  return isRuleEnabled(EMAIL_ENABLED_KEY);
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
