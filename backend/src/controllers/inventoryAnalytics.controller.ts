import { Response, NextFunction } from 'express';
import * as inventoryAnalyticsService from '../services/inventoryAnalytics.service.js';
import { getPeriodFilter } from './dashboard.controller.js';
import { AuthenticatedRequest } from '../types/index.js';

export async function getInventoryAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Reuse the dashboard period logic so ?period=monthly&year=2026&month=7
    // means exactly Jul 2026 ([Jul 1, Aug 1)) — the old version ignored
    // year/month and had no end bound.
    const period = String(req.query.period || 'all');
    const year = req.query.year !== undefined ? Number(req.query.year) : undefined;
    const month = req.query.month !== undefined ? Number(req.query.month) : undefined;
    const { start, end } = getPeriodFilter(period, year, month);
    const analytics = await inventoryAnalyticsService.getInventoryAnalytics(start, end);
    res.json(analytics);
  } catch (err) { next(err); }
}
