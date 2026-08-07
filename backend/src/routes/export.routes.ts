import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as exportService from '../services/export.service.js';

const router = Router();

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res: Response, buffer: Buffer, filename: string) {
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

router.use(authMiddleware);

router.get('/transactions', requireRole(Role.Admin, Role.Staff), async (_req, res: Response, next: NextFunction) => {
  try {
    const buffer = await exportService.exportTransactions();
    sendXlsx(res, buffer, 'transactions.xlsx');
  } catch (err) { next(err); }
});

router.get('/revenue', requireRole(Role.Admin, Role.Staff), async (_req, res: Response, next: NextFunction) => {
  try {
    const buffer = await exportService.exportRevenue();
    sendXlsx(res, buffer, 'revenue.xlsx');
  } catch (err) { next(err); }
});

router.get('/inventory', requireRole(Role.Admin, Role.Staff), async (_req, res: Response, next: NextFunction) => {
  try {
    const buffer = await exportService.exportInventory();
    sendXlsx(res, buffer, 'inventory.xlsx');
  } catch (err) { next(err); }
});

export default router;
