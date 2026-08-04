import { prisma } from '../config/database.js';
import { getBusinessRules } from './settings.service.js';

// Purge long-tail rows from the high-churn tables (Notifications, SentSms,
// AuditLog) after they are no longer operationally useful, so those tables
// don't grow unboundedly and slow both list views and the Phase-4.1 indexes.
//
// Threshold comes from the `data_retention_months` BusinessRule (default 12).
// A malformed/missing rule falls back to 12 months rather than throwing — a
// scheduler job must tolerate partial configuration. Returns purged counts so
// the scheduler can log exactly what went away.
const DEFAULT_RETENTION_MONTHS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function purgeOldData(now: Date = new Date()) {
  let retentionMonths = DEFAULT_RETENTION_MONTHS;
  try {
    const rules = await getBusinessRules();
    const raw = rules['data_retention_months'];
    const parsed = raw != null ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) retentionMonths = parsed;
  } catch { /* keep default — tolerates missing/broken rules table */ }

  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);

  // Three independent sweeping deletes. No $transaction wrapper needed:
  // (a) each deleteMany is idempotent, (b) "keep retention consistent" isn't a
  // cross-table invariant — a partial purge is still strictly ahead of no
  // purge, and (c) running them in parallel is faster than serializing inside
  // a transaction over pooled connections. Promise.all fails fast if any of
  // them reject, which surfaces the real error to the scheduler log.
  const [notifications, sentSms, auditLogs] = await Promise.all([
    prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.sentSms.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  return {
    cutoff,
    retentionMonths,
    notifications: notifications.count,
    sentSms: sentSms.count,
    auditLogs: auditLogs.count,
  };
}

// Dry-run for storage hygiene: list inventory items that still reference an
// image path but whose transactional history is long past the retention
// window — a signal the image bytes in the private bucket may be orphaned.
// Returned for review only: actual bucket deletion stays manual (Supabase has
// no per-file retention TTL and a false positive would permanently lose a
// customer-facing photo). Heuristic looks for items whose newest transaction
// is older than the same `data_retention_months` cutoff, or items with no
// transactions at all whose row predates the cutoff.
export async function orphanedImageDryRun(now: Date = new Date()) {
  let retentionMonths = DEFAULT_RETENTION_MONTHS;
  try {
    const rules = await getBusinessRules();
    const raw = rules['data_retention_months'];
    const parsed = raw != null ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) retentionMonths = parsed;
  } catch { /* keep default */ }

  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);
  const cutoffIso = cutoff.toISOString();

  const candidates = await prisma.inventoryItem.findMany({
    where: {
      image: { not: null },
      OR: [
        // No transactions at all, row older than cutoff → image untouched.
        { AND: [{ transactions: { none: {} } }, { updatedAt: { lt: cutoff } }] },
        // Has history but nothing recent → image likely stale.
        { transactions: { every: { updatedAt: { lt: cutoff } } } },
      ],
    },
    select: { id: true, name: true, image: true, updatedAt: true },
  });

  return { cutoff, retentionMonths, cutoffIso, candidates };
}
