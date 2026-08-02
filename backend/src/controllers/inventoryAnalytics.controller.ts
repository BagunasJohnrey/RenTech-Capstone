import { Response, NextFunction } from 'express';
import * as inventoryAnalyticsService from '../services/inventoryAnalytics.service.js';
import { AuthenticatedRequest } from '../types/index.js';

export async function getInventoryAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const period = String(req.query.period || 'all');
    let start: Date | undefined;
    if (period === 'monthly') start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    else if (period === 'yearly') start = new Date(new Date().getFullYear(), 0, 1);
    const analytics = await inventoryAnalyticsService.getInventoryAnalytics(start);
    res.json(analytics);
  } catch (err) { next(err); }
}
