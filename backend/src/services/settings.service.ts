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
export async function getRentalDefaults() {
  const rules = await getBusinessRules();
  return {
    rental_period_days: parseInt(rules.rental_period_days ?? '3', 10) || 3,
    return_days_after_event: parseInt(rules.return_days_after_event ?? '1', 10) || 1,
    min_downpayment: parseInt(rules.min_downpayment ?? '200', 10) || 0,
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
