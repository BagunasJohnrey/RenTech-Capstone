import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as inventoryService from '../services/inventory.service.js';
import { AuthenticatedRequest, Role } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { ItemStatus } from '@prisma/client';

// Accept numbers or numeric strings (frontend may send strings, e.g. from a
// stale build) and normalize blank/null to null.
const numOrNull = (schema: z.ZodTypeAny) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), schema.nullable().optional());

const isoDateOrNull = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : new Date(v as string).toISOString()),
  z.string().datetime().nullable().optional()
);

export const createItemSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    price: z.coerce.number().positive(),
    image: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    size: z.string().nullable().optional(),
    status: z.nativeEnum(ItemStatus).optional(),
    outOfServiceReason: z.string().nullable().optional(),
    onSale: z.boolean().optional(),
    discountPct: numOrNull(z.number().min(0).max(100)),
    salePrice: numOrNull(z.number().positive()),
    saleEndsAt: isoDateOrNull,
  }),
});

export const updateItemSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    price: z.coerce.number().positive().optional(),
    status: z.nativeEnum(ItemStatus).optional(),
    outOfServiceReason: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    size: z.string().nullable().optional(),
    onSale: z.boolean().optional(),
    discountPct: numOrNull(z.number().min(0).max(100)),
    salePrice: numOrNull(z.number().positive()),
    saleEndsAt: isoDateOrNull,
  }),
});

export const bulkStatusSchema = z.object({
  body: z.object({
    ids: z.array(z.number().int().positive()).min(1),
    status: z.nativeEnum(ItemStatus),
    outOfServiceReason: z.string().nullable().optional(),
  }),
});

export const availabilitySchema = z.object({
  query: z.object({
    itemId: z.string().transform(Number),
    rentalDate: z.string(),
    dueDate: z.string(),
  }),
});

const SALE_FIELDS = ['onSale', 'discountPct', 'salePrice', 'saleEndsAt'] as const;

function assertSaleAdminOnly(body: Record<string, unknown>, role?: Role) {
  if (role === Role.Admin) return;
  // Non-admins may not manage sale settings: silently strip them so Staff can
  // still add/edit items (the field is ignored rather than rejected).
  SALE_FIELDS.forEach((f) => { delete body[f]; });
}

export async function listItems(req: Request, res: Response, next: NextFunction) {
  try {
    const authReq = req as AuthenticatedRequest;
    const isAuthenticated = !!authReq.user;
    const status = req.query.status as string | undefined;
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;

    const isAdmin = authReq.user?.role === Role.Admin;
    const items = await inventoryService.listItems(
      isAuthenticated ? status : undefined,
      category,
      search,
      {
        rawStatus: isAuthenticated,
        // Guests get the full bookable catalog (available + currently-booked
        // items they can reserve for future dates), minus unbookable states.
        // Staff see everything except archived (Deleted) items — those are
        // Admin-only so only an Admin can review/restore them.
        exclude: !isAuthenticated
          ? ['OutOfService', 'Deleted']
          : isAdmin
            ? undefined
            : ['Deleted'],
      }
    );
    res.json(items);
  } catch (err) {
    next(err);
  }
}

export async function getItem(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    const item = await inventoryService.getItem(id);
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function createItem(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    assertSaleAdminOnly(req.body, req.user?.role);
    const item = await inventoryService.createItem(req.body);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

export async function updateItem(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);

    // Strip sale fields for non-admins before the Staff field allow-list runs.
    assertSaleAdminOnly(req.body, req.user?.role);

    if (req.user?.role === Role.Staff) {
      const allowedFields = ['name', 'category', 'price', 'description', 'size', 'image', 'status', 'outOfServiceReason'];
      const attemptedFields = Object.keys(req.body);
      const disallowed = attemptedFields.filter(f => !allowedFields.includes(f));
      if (disallowed.length > 0) {
        throw new AppError(403, `Staff cannot update fields: ${disallowed.join(', ')}`);
      }
    }

    const item = await inventoryService.updateItem(id, req.body);
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function deleteItem(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    await inventoryService.deleteItem(id);
    res.json({ message: 'Item deleted successfully' });
  } catch (err) {
    next(err);
  }
}

export async function bulkSetStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const result = await inventoryService.bulkSetStatus(
      req.body.ids,
      req.body.status as 'Available' | 'Cleaning' | 'OutOfService',
      req.body.outOfServiceReason ?? null,
      req.user.id
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function checkAvailability(req: Request, res: Response, next: NextFunction) {
  try {
    const { itemId, rentalDate, dueDate } = req.query as unknown as { itemId: string; rentalDate: string; dueDate: string };
    const result = await inventoryService.checkAvailability(Number(itemId), rentalDate, dueDate);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getBlockedDates(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    const result = await inventoryService.getBlockedDates(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
