import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

// Restore (import) for the admin one-click JSON backups (Data & Backups tab).
// Takes a previously downloaded backup file (v1/v2 payload) and upserts its
// rows back into the database in FK-dependency order.
//
// Safety rules (restore must never lock the admin out or corrupt sequences):
// - Admin + MFA only (enforced at the route), every row validated +
//   sanitized (unknown fields stripped, enums checked, dates coerced).
// - Profiles are upserted by id, but the performing admin's own row keeps its
//   current role — a foreign backup can never demote the person restoring it.
// - Rows whose REQUIRED parent is missing (e.g. a payment for a deleted
//   transaction) are skipped + counted, never force-inserted; missing OPTIONAL
//   refs are nulled instead of skipping the row.
// - transaction.txNumber is never written (autoincrement display id — writing
//   explicit values would collide with the sequence); Postgres int sequences
//   are reset to MAX(id) afterwards (best-effort).
// - Per-table row cap (5000) + per-row try/catch: one bad row skips, the rest
//   still restore. The summary reports restored/skipped per table.

export interface RestoreSummary {
  restored: Record<string, number>;
  skipped: Record<string, number>;
  truncatedTables: string[];
}

const MAX_ROWS_PER_TABLE = 5000;

const KNOWN_TABLES = new Set([
  'sms_templates',
  'business_rules',
  'profiles',
  'inventory_items',
  'promo_codes',
  'transactions',
  'payments',
  'payment_proofs',
  'notifications',
  'sent_sms',
  'audit_logs',
]);

const ROLES = new Set(['Admin', 'Staff', 'Customer']);
const ITEM_STATUSES = new Set(['Available', 'Rented', 'Reserved', 'Cleaning', 'OutOfService', 'Deleted']);
const TX_STATUSES = new Set(['Active', 'Overdue', 'Reserved', 'Returned', 'Cancelled']);
const PROOF_STATUSES = new Set(['pending', 'approved', 'rejected']);

type Row = Record<string, unknown>;
type Model = {
  findUnique?: (args: unknown) => Promise<Row | null>;
  create?: (args: unknown) => Promise<unknown>;
  update?: (args: unknown) => Promise<unknown>;
};

function models(): Record<string, Model> {
  const p = prisma as unknown as Record<string, Model | undefined>;
  return {
    smsTemplate: p.smsTemplate ?? {},
    businessRule: p.businessRule ?? {},
    profile: p.profile ?? {},
    promoCode: (p as Record<string, Model | undefined>).promoCode ?? {},
    inventoryItem: p.inventoryItem ?? {},
    transaction: p.transaction ?? {},
    payment: p.payment ?? {},
    paymentProof: p.paymentProof ?? {},
    notification: p.notification ?? {},
    sentSms: p.sentSms ?? {},
    auditLog: p.auditLog ?? {},
  };
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;
const strOrNull = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : typeof v === 'string' ? v : String(v);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : fallback;
const dateOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const dateOrNow = (v: unknown): string => dateOrNull(v) ?? new Date().toISOString();
const jsonOrNull = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return null;
};

async function upsertById(m: Model, id: string | number, createData: Row, updateData: Row): Promise<'created' | 'updated'> {
  const existing = await m.findUnique?.({ where: { id } });
  if (existing) {
    await m.update?.({ where: { id }, data: updateData });
    return 'updated';
  }
  await m.create?.({ data: { id, ...createData } });
  return 'created';
}

export function validateBackupPayload(payload: unknown): { tables: Record<string, Row[]>; id: string | null } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError(400, 'Invalid backup file: expected a JSON object');
  }
  const p = payload as { tables?: unknown; id?: unknown };
  if (!p.tables || typeof p.tables !== 'object' || Array.isArray(p.tables)) {
    throw new AppError(400, 'Invalid backup file: missing "tables"');
  }
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(p.tables as Record<string, unknown>)) {
    if (!KNOWN_TABLES.has(k)) continue; // ignore unknown/future tables
    if (!Array.isArray(v)) throw new AppError(400, `Invalid backup file: table "${k}" is not a list`);
    if (v.length > MAX_ROWS_PER_TABLE) {
      throw new AppError(400, `Invalid backup file: table "${k}" exceeds ${MAX_ROWS_PER_TABLE} rows`);
    }
    tables[k] = v.filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r));
  }
  if (Object.keys(tables).length === 0) {
    throw new AppError(400, 'Invalid backup file: no recognized tables');
  }
  return { tables, id: typeof p.id === 'string' ? p.id : null };
}

export async function restoreBackup(payload: unknown, performedById: string | null): Promise<RestoreSummary> {
  const { tables } = validateBackupPayload(payload);
  const m = models();
  const restored: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const truncatedTables: string[] = [];
  const bump = (bucket: Record<string, number>, table: string) => {
    bucket[table] = (bucket[table] ?? 0) + 1;
  };

  // 1. Reference/config tables (no FK parents).
  for (const r of tables.sms_templates ?? []) {
    try {
      const id = str(r.id);
      const name = str(r.name);
      const content = str(r.content);
      if (!id || !name || !content) throw new Error('missing id/name/content');
      const data = { name: name.slice(0, 100), content: content.slice(0, 1600), isDefault: bool(r.isDefault) };
      await upsertById(m.smsTemplate, id, { ...data, createdAt: dateOrNow(r.createdAt), updatedAt: dateOrNow(r.updatedAt) }, data);
      bump(restored, 'sms_templates');
    } catch {
      bump(skipped, 'sms_templates');
    }
  }

  for (const r of tables.business_rules ?? []) {
    try {
      const key = str(r.key);
      const value = r.value === undefined || r.value === null ? null : String(r.value);
      if (!key || value === null) throw new Error('missing key/value');
      const existing = await m.businessRule.findUnique?.({ where: { key } });
      if (existing) {
        await m.businessRule.update?.({ where: { key }, data: { value } });
      } else {
        await m.businessRule.create?.({ data: { key, value, description: strOrNull(r.description) } });
      }
      bump(restored, 'business_rules');
    } catch {
      bump(skipped, 'business_rules');
    }
  }

  // 2. Profiles (auth-linked — upsert by id, but never change the performing
  // admin's own role via restore).
  for (const r of tables.profiles ?? []) {
    try {
      const id = str(r.id);
      const userId = str(r.userId);
      const email = str(r.email);
      const name = str(r.name);
      const role = str(r.role);
      if (!id || !userId || !email || !name || !role || !ROLES.has(role)) throw new Error('missing/invalid profile fields');
      const existing = await m.profile.findUnique?.({ where: { id } });
      const keepRole = existing && id === performedById ? (existing as Row).role : role;
      const data: Row = {
        userId, email, name: String(name).slice(0, 200), role: keepRole,
        phone: strOrNull(r.phone), address: strOrNull(r.address),
        preferences: strOrNull(r.preferences), notifyPrefs: jsonOrNull(r.notifyPrefs),
        styleNotes: strOrNull(r.styleNotes), mfaEnabled: bool(r.mfaEnabled),
        totpSecret: strOrNull(r.totpSecret), backupCodes: jsonOrNull(r.backupCodes),
        mustChangePassword: bool(r.mustChangePassword),
        createdAt: dateOrNow(r.createdAt), updatedAt: dateOrNow(r.updatedAt),
      };
      if (existing) {
        const { createdAt: _c, ...updateData } = data;
        await m.profile.update?.({ where: { id }, data: updateData });
      } else {
        await m.profile.create?.({ data: { id, ...data } });
      }
      bump(restored, 'profiles');
    } catch {
      bump(skipped, 'profiles');
    }
  }

  // 3. Promo codes (unique code — a clash with a different id skips the row).
  for (const r of tables.promo_codes ?? []) {
    try {
      const id = str(r.id);
      const code = str(r.code);
      const discountPct = numOrNull(r.discountPct);
      if (!id || !code || discountPct === null) throw new Error('missing id/code/discountPct');
      const data: Row = {
        code, discountPct,
        maxUses: numOrNull(r.maxUses), currentUses: numOrNull(r.currentUses) ?? 0,
        expiresAt: dateOrNull(r.expiresAt), isActive: typeof r.isActive === 'boolean' ? r.isActive : true,
        createdAt: dateOrNow(r.createdAt), updatedAt: dateOrNow(r.updatedAt),
      };
      await upsertById(m.promoCode, id, data, { ...data, createdAt: undefined });
      bump(restored, 'promo_codes');
    } catch {
      bump(skipped, 'promo_codes');
    }
  }

  // 4. Inventory items (Int id referenced by transactions — explicit ids kept).
  for (const r of tables.inventory_items ?? []) {
    try {
      const id = typeof r.id === 'number' ? r.id : Number(r.id);
      const name = str(r.name);
      const category = str(r.category);
      const price = numOrNull(r.price);
      const status = str(r.status);
      if (!Number.isInteger(id) || !name || !category || price === null || !status || !ITEM_STATUSES.has(status)) {
        throw new Error('missing/invalid item fields');
      }
      const data: Row = {
        name: name.slice(0, 200), category: category.slice(0, 100), price, status,
        image: strOrNull(r.image), description: strOrNull(r.description), size: strOrNull(r.size),
        onSale: bool(r.onSale), discountPct: numOrNull(r.discountPct), salePrice: numOrNull(r.salePrice),
        saleEndsAt: dateOrNull(r.saleEndsAt), outOfServiceReason: strOrNull(r.outOfServiceReason),
        createdAt: dateOrNow(r.createdAt), updatedAt: dateOrNow(r.updatedAt),
      };
      await upsertById(m.inventoryItem, id, data, { ...data, createdAt: undefined });
      bump(restored, 'inventory_items');
    } catch {
      bump(skipped, 'inventory_items');
    }
  }

  // 5. Transactions (required: customer + item; optional refs nulled if gone).
  for (const r of tables.transactions ?? []) {
    try {
      const id = str(r.id);
      const customerId = str(r.customerId);
      const itemId = typeof r.itemId === 'number' ? r.itemId : Number(r.itemId);
      const status = str(r.status);
      const rentalFee = numOrNull(r.rentalFee);
      const balance = numOrNull(r.balance);
      const rentalDate = dateOrNull(r.rentalDate);
      const dueDate = dateOrNull(r.dueDate);
      if (!id || !customerId || !Number.isInteger(itemId) || !status || !TX_STATUSES.has(status) ||
          rentalFee === null || balance === null || !rentalDate || !dueDate) {
        throw new Error('missing/invalid transaction fields');
      }
      const [customer, item] = await Promise.all([
        m.profile.findUnique?.({ where: { id: customerId } }),
        m.inventoryItem.findUnique?.({ where: { id: itemId } }),
      ]);
      if (!customer || !item) throw new Error('missing customer/item');
      const processedById = str(r.processedById);
      const assistedById = str((r as Row).assistedById);
      const releasedById = str((r as Row).releasedById);
      const promoCodeId = str(r.promoCodeId);
      const [processedBy, assistedBy, releasedBy, promo] = await Promise.all([
        processedById ? m.profile.findUnique?.({ where: { id: processedById } }) : Promise.resolve(null),
        assistedById ? m.profile.findUnique?.({ where: { id: assistedById } }) : Promise.resolve(null),
        releasedById ? m.profile.findUnique?.({ where: { id: releasedById } }) : Promise.resolve(null),
        promoCodeId ? m.promoCode.findUnique?.({ where: { id: promoCodeId } }) : Promise.resolve(null),
      ]);
      const data: Row = {
        customerId, processedById: processedBy ? processedById : null,
        assistedById: assistedBy ? assistedById : null,
        releasedById: releasedBy ? releasedById : null, itemId,
        promoCodeId: promo ? promoCodeId : null,
        rentalDate, dueDate, returnDate: dateOrNull(r.returnDate), status,
        rentalFee, downpayment: numOrNull(r.downpayment) ?? 0,
        latePenalty: numOrNull(r.latePenalty) ?? 0, damageFee: numOrNull(r.damageFee) ?? 0,
        totalPaid: numOrNull(r.totalPaid) ?? 0, balance,
        conditionPhoto: strOrNull(r.conditionPhoto), releasePhoto: strOrNull(r.releasePhoto),
        returnPhoto: strOrNull(r.returnPhoto),
        dueReminderSent: bool(r.dueReminderSent), noShowNotified: bool(r.noShowNotified),
        overdueSmsSent: bool(r.overdueSmsSent), overdueSmsRetried: bool(r.overdueSmsRetried),
        overdueEscalationSent: bool(r.overdueEscalationSent),
        damageReason: strOrNull(r.damageReason), notes: strOrNull(r.notes),
        alterationStatus: strOrNull(r.alterationStatus), size: strOrNull(r.size),
        measurements: jsonOrNull(r.measurements),
        // Gateway rename (Sept 2026): current backups carry gateway* keys;
        // pre-rename files carry paymentIntentId — accept both. Unknown keys
        // would throw in Prisma and silently skip the row, so the old name
        // must not be passed through verbatim.
        gateway: strOrNull(r.gateway),
        gatewayPaymentId: strOrNull(r.gatewayPaymentId ?? r.paymentIntentId),
        // Reminder email once-guards (Oct 2026) — old backups lack them and
        // default to false (one re-send at most after a restore, then quiet).
        dueReminderEmailSent: bool(r.dueReminderEmailSent),
        overdueEmailSent: bool(r.overdueEmailSent),
        overdueEscalationEmailSent: bool(r.overdueEscalationEmailSent),
        createdAt: dateOrNow(r.createdAt), updatedAt: dateOrNow(r.updatedAt),
      };
      // txNumber is autoincrement — never written (avoids sequence clashes).
      await upsertById(m.transaction, id, data, data);
      bump(restored, 'transactions');
    } catch {
      bump(skipped, 'transactions');
    }
  }

  // 6. Child rows (required parent missing → skip; optional refs nulled).
  for (const r of tables.payments ?? []) {
    try {
      const id = str(r.id);
      const transactionId = str(r.transactionId);
      const amount = numOrNull(r.amount);
      const method = str(r.method);
      const type = str(r.type);
      if (!id || !transactionId || amount === null || !method || !type) throw new Error('missing payment fields');
      const parent = await m.transaction.findUnique?.({ where: { id: transactionId } });
      if (!parent) throw new Error('missing transaction');
      const data: Row = {
        transactionId, amount, method, type,
        // Gateway rename (Sept 2026) — see transaction note above. gateway is
        // required in the schema, so fall back to the static-QR default.
        gateway: strOrNull(r.gateway) ?? 'manual',
        gatewayRef: strOrNull(r.gatewayRef ?? r.paymongoPiId),
        status: str(r.status) ?? 'pending', createdAt: dateOrNow(r.createdAt),
      };
      await upsertById(m.payment, id, data, { ...data, createdAt: undefined });
      bump(restored, 'payments');
    } catch {
      bump(skipped, 'payments');
    }
  }

  // 6b. Payment proofs (manual-QR evidence — parent transaction required;
  // reviewer is optional and nulled if their profile is gone).
  for (const r of tables.payment_proofs ?? []) {
    try {
      const id = str(r.id);
      const transactionId = str(r.transactionId);
      const amount = numOrNull(r.amount);
      const imagePath = str(r.imagePath);
      if (!id || !transactionId || amount === null || !imagePath) throw new Error('missing payment proof fields');
      const parent = await m.transaction.findUnique?.({ where: { id: transactionId } });
      if (!parent) throw new Error('missing transaction');
      const reviewedById = str(r.reviewedById);
      const reviewer = reviewedById ? await m.profile.findUnique?.({ where: { id: reviewedById } }) : null;
      const status = str(r.status);
      const data: Row = {
        transactionId,
        amount,
        reference: strOrNull(r.reference),
        channel: strOrNull(r.channel),
        imagePath,
        status: status && PROOF_STATUSES.has(status) ? status : 'pending',
        rejectionReason: strOrNull(r.rejectionReason),
        reviewedById: reviewer ? reviewedById : null,
        reviewedAt: dateOrNull(r.reviewedAt),
        createdAt: dateOrNow(r.createdAt),
      };
      await upsertById(m.paymentProof, id, data, { ...data, createdAt: undefined });
      bump(restored, 'payment_proofs');
    } catch {
      bump(skipped, 'payment_proofs');
    }
  }

  for (const r of tables.notifications ?? []) {
    try {
      const id = str(r.id);
      const profileId = str(r.profileId);
      const type = str(r.type);
      const title = str(r.title);
      const message = str(r.message);
      if (!id || !profileId || !type || !title || !message) throw new Error('missing notification fields');
      const owner = await m.profile.findUnique?.({ where: { id: profileId } });
      if (!owner) throw new Error('missing profile');
      const transactionId = str(r.transactionId);
      const tx = transactionId ? await m.transaction.findUnique?.({ where: { id: transactionId } }) : null;
      const data: Row = {
        profileId, transactionId: tx ? transactionId : null, type,
        title: title.slice(0, 200), message: message.slice(0, 2000),
        isRead: bool(r.isRead), createdAt: dateOrNow(r.createdAt),
      };
      await upsertById(m.notification, id, data, { ...data, createdAt: undefined });
      bump(restored, 'notifications');
    } catch {
      bump(skipped, 'notifications');
    }
  }

  for (const r of tables.sent_sms ?? []) {
    try {
      const id = str(r.id);
      const profileId = str(r.profileId);
      const message = str(r.message);
      if (!id || !profileId || !message) throw new Error('missing sms fields');
      const owner = await m.profile.findUnique?.({ where: { id: profileId } });
      if (!owner) throw new Error('missing profile');
      const sentById = str(r.sentById);
      const transactionId = str(r.transactionId);
      const templateId = str(r.templateId);
      const [sentBy, tx, tmpl] = await Promise.all([
        sentById ? m.profile.findUnique?.({ where: { id: sentById } }) : Promise.resolve(null),
        transactionId ? m.transaction.findUnique?.({ where: { id: transactionId } }) : Promise.resolve(null),
        templateId ? m.smsTemplate.findUnique?.({ where: { id: templateId } }) : Promise.resolve(null),
      ]);
      const data: Row = {
        profileId, sentById: sentBy ? sentById : null,
        transactionId: tx ? transactionId : null, templateId: tmpl ? templateId : null,
        message: message.slice(0, 1600),
        status: str(r.status) ?? 'sent', createdAt: dateOrNow(r.createdAt),
      };
      await upsertById(m.sentSms, id, data, { ...data, createdAt: undefined });
      bump(restored, 'sent_sms');
    } catch {
      bump(skipped, 'sent_sms');
    }
  }

  for (const r of tables.audit_logs ?? []) {
    try {
      const id = str(r.id);
      const action = str(r.action);
      const entity = str(r.entity);
      const entityId = str(r.entityId);
      if (!id || !action || !entity || !entityId) throw new Error('missing audit fields');
      const data: Row = {
        action: action.slice(0, 100), entity: entity.slice(0, 100), entityId: entityId.slice(0, 200),
        performedById: strOrNull(r.performedById),
        oldValue: jsonOrNull(r.oldValue) ?? undefined, newValue: jsonOrNull(r.newValue) ?? undefined,
        createdAt: dateOrNow(r.createdAt),
      };
      await upsertById(m.auditLog, id, data, { ...data, createdAt: undefined });
      bump(restored, 'audit_logs');
    } catch {
      bump(skipped, 'audit_logs');
    }
  }

  // 7. Reset Postgres int sequences past restored explicit ids (best-effort;
  // skipped on non-Postgres / mocked clients).
  try {
    const raw = (prisma as unknown as { $executeRawUnsafe?: (sql: string) => Promise<unknown> }).$executeRawUnsafe;
    if (typeof raw === 'function') {
      await raw.call(prisma, `SELECT setval(pg_get_serial_sequence('inventory_items','id'), (SELECT MAX(id) FROM inventory_items))`);
    }
  } catch {
    truncatedTables.push('sequences_skipped');
  }

  return { restored, skipped, truncatedTables };
}
