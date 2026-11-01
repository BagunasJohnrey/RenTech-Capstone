import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole, requireMfaAdmin } from '../middleware/rbac.js';
import { Role, AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import * as auditService from '../services/audit.service.js';
import { exportAuditTrail } from '../services/export.service.js';
import { createAuditLog } from '../utils/audit.js';

// Admin-only audit trail: who did what, when. Same MFA gate as the other
// admin data routes (backups, rules) since it exposes staff activity + PII.
const router = Router();

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional();
const filtersSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(auditService.AUDIT_MAX_PAGE_SIZE).optional(),
  from: ymd,
  to: ymd,
  actorId: z.string().max(64).optional(),
  action: z.string().max(80).optional(),
  entity: z.string().max(80).optional(),
  q: z.string().max(100).optional(),
});

function parseFilters(req: Request): auditService.AuditFilters {
  // Drop empty strings sent by cleared filter inputs before validating.
  const query = Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== ''));
  const parsed = filtersSchema.safeParse(query);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message || 'Invalid filters');
  const f: auditService.AuditFilters = parsed.data;
  if (f.from && f.to && f.from > f.to) throw new AppError(400, '"From" date must be on or before "To" date');
  return f;
}

router.use(authMiddleware, requireRole(Role.Admin), requireMfaAdmin);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await auditService.listAuditLogs(parseFilters(req)));
  } catch (err) { next(err); }
});

router.get('/facets', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await auditService.listAuditFacets());
  } catch (err) { next(err); }
});

router.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const f = parseFilters(req);
    const rows = await auditService.listAuditLogsForExport(f);
    const scope = f.from || f.to ? `${f.from ?? 'start'} to ${f.to ?? 'today'}` : 'All dates';
    const u = authReq.user;
    const buffer = await exportAuditTrail(rows, scope, u ? { name: u.name || u.email, role: String(u.role) } : undefined);
    const filename = `rentech-audit-trail-${new Date().toISOString().slice(0, 10)}.xlsx`;
    try {
      await createAuditLog({
        action: 'export.download', entity: 'export', entityId: 'audit-trail',
        performedById: u?.id ?? null,
        newValue: { report: 'audit-trail', scope, filename, rows: rows.length },
      });
    } catch { /* audit is non-critical */ }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

export default router;
