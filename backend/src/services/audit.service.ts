import { prisma } from '../config/database.js';

// Read side of the audit trail (writes go through utils/audit.ts). Powers the
// Admin "Audit Trail" page and its Excel export.

export interface AuditFilters {
  page?: number;
  pageSize?: number;
  from?: string;   // YYYY-MM-DD, Manila day (inclusive)
  to?: string;     // YYYY-MM-DD, Manila day (inclusive)
  actorId?: string;
  action?: string;
  entity?: string;
  q?: string;      // matches action or the target id
}

export interface AuditActor { id: string; name: string; email: string; role: string }

export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  createdAt: Date;
  oldValue: unknown;
  newValue: unknown;
  actor: AuditActor | null; // null = system (scheduler / automatic job)
}

export const AUDIT_MAX_PAGE_SIZE = 100;
export const AUDIT_EXPORT_LIMIT = 5000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Manila is UTC+8 with no DST, so a fixed offset is exact.
function manilaDay(ymd: string, addDays = 0): Date | undefined {
  if (!YMD.test(ymd)) return undefined;
  const d = new Date(`${ymd}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + addDays);
  return d;
}

function buildWhere(f: AuditFilters) {
  const where: Record<string, unknown> = {};
  const gte = f.from ? manilaDay(f.from) : undefined;
  const lt = f.to ? manilaDay(f.to, 1) : undefined;
  if (gte || lt) where.createdAt = { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
  if (f.actorId === 'system') where.performedById = null;
  else if (f.actorId) where.performedById = f.actorId;
  if (f.action) where.action = f.action;
  if (f.entity) where.entity = f.entity;
  const q = f.q?.trim();
  if (q) {
    where.OR = [
      { action: { contains: q, mode: 'insensitive' } },
      { entityId: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
}

async function actorsById(ids: (string | null)[]): Promise<Map<string, AuditActor>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const profiles = await prisma.profile.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true, role: true },
  });
  return new Map(profiles.map((p) => [p.id, { id: p.id, name: p.name || p.email, email: p.email, role: String(p.role) }]));
}

async function withActors(logs: Awaited<ReturnType<typeof prisma.auditLog.findMany>>): Promise<AuditRow[]> {
  const actors = await actorsById(logs.map((l) => l.performedById));
  return logs.map((l) => ({
    id: l.id,
    action: l.action,
    entity: l.entity,
    entityId: l.entityId,
    createdAt: l.createdAt,
    oldValue: l.oldValue ?? null,
    newValue: l.newValue ?? null,
    actor: l.performedById
      // A deleted profile keeps its id on old rows; show it as unknown.
      ? actors.get(l.performedById) ?? { id: l.performedById, name: 'Removed user', email: '', role: '' }
      : null,
  }));
}

export async function listAuditLogs(f: AuditFilters) {
  const pageSize = Math.min(Math.max(Math.trunc(f.pageSize ?? 25) || 25, 1), AUDIT_MAX_PAGE_SIZE);
  const page = Math.max(Math.trunc(f.page ?? 1) || 1, 1);
  const where = buildWhere(f);
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { rows: await withActors(logs), total, page, pageSize };
}

// Newest-first rows for the Excel export, capped so one click can't pull the
// whole table into memory.
export async function listAuditLogsForExport(f: AuditFilters): Promise<AuditRow[]> {
  const logs = await prisma.auditLog.findMany({
    where: buildWhere(f),
    orderBy: { createdAt: 'desc' },
    take: AUDIT_EXPORT_LIMIT,
  });
  return withActors(logs);
}

// Filter dropdown options: every action / entity / actor that appears.
export async function listAuditFacets() {
  const [actions, entities, performers] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['performedById'], select: { performedById: true } }),
  ]);
  const actors = await actorsById(performers.map((p) => p.performedById));
  return {
    actions: actions.map((a) => a.action),
    entities: entities.map((e) => e.entity),
    actors: [...actors.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
