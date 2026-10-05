import { Response, NextFunction } from 'express';
import * as dashboardService from '../services/dashboard.service.js';
import { AuthenticatedRequest } from '../types/index.js';

// getPeriodFilter returns an open-ended [start, now] window for the built-in
// periods, or a bounded [start, end) window when the client pins a specific
// month/year. The service fills in `end` when start is set but end isn't
// ("one month after start"), so a past month correctly returns only THAT
// month instead of everything since.
export function getPeriodFilter(period?: string, year?: number, month?: number): { start?: Date; end?: Date; past?: boolean; weekly?: boolean } {
  const now = new Date();
  const thisYear = now.getFullYear();
  if (period === 'monthly') {
    const y = Number.isInteger(year) && year! >= 2000 && year! <= thisYear ? year! : thisYear;
    const m = Number.isInteger(month) && month! >= 1 && month! <= 12 ? month! - 1 : now.getMonth();
    const start = new Date(y, m, 1);
    // Requesting a future month is meaningless — fall back to the current month.
    const isCurrentOrFuture = y === thisYear && m > now.getMonth();
    const effective = isCurrentOrFuture ? new Date(thisYear, now.getMonth(), 1) : start;
    const end = new Date(effective.getFullYear(), effective.getMonth() + 1, 1);
    // weekly: emit the per-week revenue breakdown. past: window is fully over.
    return { start: effective, end, past: end <= now, weekly: true };
  }
  if (period === 'yearly') {
    const y = Number.isInteger(year) && year! >= 2000 && year! <= thisYear ? year! : thisYear;
    const start = new Date(y, 0, 1);
    const end = new Date(y + 1, 0, 1);
    return { start, end, past: end <= now };
  }
  return {};
}

export async function getKpis(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const period = String(req.query.period || 'all');
    const year = req.query.year !== undefined ? Number(req.query.year) : undefined;
    const month = req.query.month !== undefined ? Number(req.query.month) : undefined;
    const kpis = await dashboardService.getKpis(getPeriodFilter(period, year, month));
    res.json(kpis);
  } catch (err) {
    next(err);
  }
}

export async function getTodayTasks(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const tasks = await dashboardService.getTodayTasks();
    res.json(tasks);
  } catch (err) {
    next(err);
  }
}

export async function getAvailableYears(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await dashboardService.getAvailableYears());
  } catch (err) {
    next(err);
  }
}

export async function getForecast(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // L6: clamp the forecast window (1–12) — a huge period would fan out
    // unbounded aggregation work.
    const raw = Number(req.query.period);
    const period = Number.isFinite(raw) && raw >= 1 && raw <= 12 ? Math.floor(raw) : 3;
    const granularity = String(req.query.granularity || '').toLowerCase() === 'weekly' ? 'weekly' : 'monthly';
    const data = await dashboardService.getForecast(period, granularity);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getInsights(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const period = String(req.query.period || 'all');
    const year = req.query.year !== undefined ? Number(req.query.year) : undefined;
    const month = req.query.month !== undefined ? Number(req.query.month) : undefined;
    const data = await dashboardService.getInsights(getPeriodFilter(period, year, month));
    res.json(data);
  } catch (err) {
    next(err);
  }
}

// Single payload for the AI Insights page — replaces the old 4-request fan-out
// (kpis + insights + forecast + inventory-analytics) with one cached bundle.
export async function getBundle(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const period = String(req.query.period || 'all');
    const year = req.query.year !== undefined ? Number(req.query.year) : undefined;
    const month = req.query.month !== undefined ? Number(req.query.month) : undefined;
    const fp = Number(req.query.fp);
    const forecastPeriod = Number.isFinite(fp) && fp >= 1 && fp <= 12 ? Math.floor(fp) : 3;
    const data = await dashboardService.getDashboardBundle(getPeriodFilter(period, year, month), forecastPeriod);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
