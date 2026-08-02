import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, Role } from '../types/index.js';
import { AppError } from './errorHandler.js';

export function requireRole(...allowedRoles: Role[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, 'Authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(403, 'Insufficient permissions');
    }

    next();
  };
}
