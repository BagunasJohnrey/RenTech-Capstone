import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { prisma } from '../config/database.js';
import { AuthenticatedRequest, AuthUser, Role } from '../types/index.js';
import { AppError } from './errorHandler.js';

export async function authMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing or invalid authorization header');
    }

    const token = authHeader.split(' ')[1];

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      throw new AppError(401, 'Invalid or expired token');
    }

    const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      throw new AppError(401, 'Profile not found');
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      role: profile.role as Role,
      name: profile.name,
      phone: profile.phone ?? undefined,
    };

    next();
  } catch (err) {
    next(err);
  }
}

// Same as authMiddleware but NON-BLOCKING: it attaches req.user when a valid
// token is present, yet still calls next() (without setting req.user) when no
// token is provided or it's invalid. This lets public/guest endpoints (e.g. the
// inventory catalog) serve the full authenticated view to logged-in staff while
// still allowing anonymous browsing.
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return next();
    }

    const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      return next();
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      role: profile.role as Role,
      name: profile.name,
      phone: profile.phone ?? undefined,
    };
  } catch {
    // Ignore auth errors for optional auth — treat as anonymous.
  }
  next();
}
