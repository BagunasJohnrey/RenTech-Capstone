import { Response, NextFunction } from 'express';
import * as dashboardService from '../services/dashboard.service.js';
import { AuthenticatedRequest } from '../types/index.js';

function getPeriodFilter(period?: string): { start?: Date; end?: Date } {
  if (period === 'monthly') {
    const now = new Date();
    return { start: new Date(now.getFullYear(), now.getMonth(), 1) };
  }
  if (period === 'yearly') {
    const now = new Date();
    return { start: new Date(now.getFullYear(), 0, 1) };
  }
  return {};
}

export async function getKpis(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const period = String(req.query.period || 'all');
    const kpis = await dashboardService.getKpis(getPeriodFilter(period));
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

export async function getForecast(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const period = req.query.period ? Number(req.query.period) : 3;
    const data = await dashboardService.getForecast(period);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getInsights(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const period = String(req.query.period || 'all');
    const data = await dashboardService.getInsights(getPeriodFilter(period));
    res.json(data);
  } catch (err) {
    next(err);
  }
}
