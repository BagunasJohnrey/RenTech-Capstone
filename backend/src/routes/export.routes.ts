import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as exportService from '../services/export.service.js';

const router = Router();

router.use(authMiddleware);

router.get('/transactions', requireRole(Role.Admin, Role.Staff), async (_req, res: Response, next: NextFunction) => {
  try {
    const csv = await exportService.exportTransactions();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

router.get('/revenue', requireRole(Role.Admin, Role.Staff), async (_req, res: Response, next: NextFunction) => {
  try {
    const csv = await exportService.exportRevenue();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="revenue.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

router.get('/inventory', requireRole(Role.Admin, Role.Staff), async (_req, res: Response, next: NextFunction) => {
  try {
    const csv = await exportService.exportInventory();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

export default router;
