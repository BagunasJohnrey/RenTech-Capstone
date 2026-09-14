import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import { getPeriodFilter } from '../controllers/dashboard.controller.js';
import * as exportService from '../services/export.service.js';

const router = Router();

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res: Response, buffer: Buffer, filename: string) {
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

router.use(authMiddleware);

// One .xlsx with Transactions + Revenue + Inventory as separate sheets,
// scoped to the dashboard period (Overall / Yearly / Monthly + year/month).
router.get('/workbook', requireRole(Role.Admin, Role.Staff), async (req, res: Response, next: NextFunction) => {
  try {
    const period = String(req.query.period || 'overall').toLowerCase();
    const year = req.query.year !== undefined ? Number(req.query.year) : undefined;
    const month = req.query.month !== undefined ? Number(req.query.month) : undefined;
    const win = getPeriodFilter(period, year, month);
    let scopeLabel = 'Overall';
    let filename = 'rentech-report-overall.xlsx';
    if (period === 'monthly' && win.start) {
      scopeLabel = win.start.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      filename = `rentech-report-${win.start.getFullYear()}-${String(win.start.getMonth() + 1).padStart(2, '0')}.xlsx`;
    } else if (period === 'yearly' && win.start) {
      scopeLabel = String(win.start.getFullYear());
      filename = `rentech-report-${win.start.getFullYear()}.xlsx`;
    }
    const buffer = await exportService.exportWorkbook(win, scopeLabel);
    sendXlsx(res, buffer, filename);
  } catch (err) { next(err); }
});

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
