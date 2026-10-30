import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as storageService from '../services/storage.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../config/database.js';
import { Role } from '../types/index.js';

const pathFromParams = (req: AuthenticatedRequest): string => {
  const raw = req.params.path as unknown;
  return Array.isArray(raw) ? raw.join('/') : (typeof raw === 'string' ? raw : '');
};

// Private photos need a signed-in user; catalog photos skip auth entirely.
export function requireAuthForPrivate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!storageService.isConditionPath(pathFromParams(req))) return next();
  return authMiddleware(req, res, next);
}

// Private keys look like `rental/<owner>/<file>` (or the same under
// `thumbs/`), where <owner> is the booking id (release/return photos, proof
// resubmissions) or the customer's own id (proofs sent with a booking).
// Staff/Admin may see any; a customer only their own bookings' photos.
// Unknown or someone else's → 404, so the endpoint never confirms that a
// path exists.
async function canViewPrivatePath(req: AuthenticatedRequest, path: string): Promise<boolean> {
  const user = req.user;
  if (!user) return false;
  if (user.role === Role.Admin || user.role === Role.Staff) return true;
  const parts = path.replace(/^thumbs\//, '').split('/');
  if (parts.length < 3 || parts[0] !== 'rental' || parts.some((p) => !p || p === '.' || p === '..')) return false;
  const owner = parts[1];
  if (owner === user.id) return true;
  const tx = await prisma.transaction.findUnique({ where: { id: owner }, select: { customerId: true } }).catch(() => null);
  return tx?.customerId === user.id;
}

export const uploadSchema = z.object({
  body: z.object({
    fileName: z.string().min(1),
    contentType: z.string().min(1),
    data: z.string().min(1),
  }),
});

export async function upload(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { fileName, contentType, data } = req.body;
    const buffer = Buffer.from(data, 'base64');
    const result = await storageService.uploadFile(fileName, contentType, buffer);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getDownloadUrl(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Express 5 named wildcard: params.path is an array of segments.
    // e.g. GET /storage/rental/abc/file.jpg → params.path = ['rental','abc','file.jpg']
    const path = pathFromParams(req);

    // Browser blob URLs are client-only — never storeable; reject them early.
    if (path.startsWith('blob:')) {
      return next(new AppError(400, 'Blob preview URLs cannot be served from storage. Re-upload the file.'));
    }
    if (!path) {
      return next(new AppError(404, 'Missing file path'));
    }

    if (storageService.isConditionPath(path) && !(await canViewPrivatePath(req, path))) {
      return next(new AppError(404, 'File not found'));
    }

    const result = await storageService.getDownloadUrl(path);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
