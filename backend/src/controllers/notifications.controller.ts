import { Response, NextFunction } from 'express';
import * as notificationService from '../services/notifications.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export async function listNotifications(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const notifications = await notificationService.listNotifications(req.user.id);
    res.json(notifications);
  } catch (err) {
    next(err);
  }
}

export async function markAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const notification = await notificationService.markAsRead(String(req.params.id), req.user.id);
    res.json(notification);
  } catch (err) {
    next(err);
  }
}

export async function markAllAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    await notificationService.markAllAsRead(req.user.id);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const count = await notificationService.getUnreadCount(req.user.id);
    res.json({ count });
  } catch (err) {
    next(err);
  }
}
