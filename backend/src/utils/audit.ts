import { prisma } from '../config/database.js';

export async function createAuditLog(params: {
  action: string;
  entity: string;
  entityId: string;
  performedById?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      performedById: params.performedById ?? null,
      oldValue: params.oldValue ?? undefined,
      newValue: params.newValue ?? undefined,
    },
  });
}
