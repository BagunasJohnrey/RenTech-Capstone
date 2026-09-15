import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as inventoryService from '../services/inventory.service.js';
import { AuthenticatedRequest, Role } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { ItemStatus } from '@prisma/client';

// Accept numbers or numeric strings (frontend may send strings, e.g. from a
// stale build) and normalize blank/null to null. Missing keys stay undefined
// so they are stripped from the parsed body (keeps empty-body detection sane).
const numOrNull = (schema: z.ZodTypeAny) =>
  z.preprocess((v) => (v === undefined ? undefined : (v === '' || v === null ? null : Number(v))), schema.nullable().optional());

const isoDateOrNull = z.preprocess(
  // Missing → undefined (stripped). Blank/null → null (explicit clear).
  // Anything else goes through .datetime(), which rejects garbage with a 400
  // (never throwing a RangeError that would surface as a 500).
  (v) => {
    if (v === undefined) return undefined;
    if (v === '' || v === null) return null;
    return v;
  },
  z.string().datetime().nullable().optional()
);

export const createItemSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    occasions: z.array(z.string().min(1).max(40)).max(12).optional(),
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
    occasions: z.array(z.string().min(1).max(40)).max(12).optional(),
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
  }).refine((b) => Object.keys(b).length > 0, {
    message: 'At least one field must be provided',
  }),
});

export const bulkStatusSchema = z.object({
  body: z.object({
    ids: z.array(z.number().int().positive()).min(1),
    status: z.nativeEnum(ItemStatus),
    outOfServiceReason: z.string().nullable().optional(),
  }),
});

export const bulkSaleSchema = z.object({
  body: z.object({
    ids: z.array(z.number().int().positive()).min(1),
    onSale: z.boolean(),
    discountPct: numOrNull(z.number().min(0).max(100)),
    salePrice: numOrNull(z.number().positive()),
    saleEndsAt: isoDateOrNull,
  }),
});

export const availabilitySchema = z.object({
  query: z.object({
    // Numeric guard: transform would yield NaN for "abc"; reject as 400 not 500.
    itemId: z.string().transform(Number).pipe(z.number().int().positive()),
    rentalDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid rental date'),
    dueDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid due date'),
  }),
});

// Parse a positive-int route param, throwing 400 (not 500) on garbage ids.
function parseIdParam(raw: string | string[], label = 'id'): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, `Invalid ${label}`);
  return n;
}

// Length-cap free-text query params (search/category) to keep LIKE scans sane.
const MAX_Q = 120;
function capQuery(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const s = String(raw).slice(0, MAX_Q);
  return s === '' ? undefined : s;
}

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
    const status = capQuery(req.query.status as string | undefined);
    const category = capQuery(req.query.category as string | undefined);
    const occasion = capQuery(req.query.occasion as string | undefined);
    const search = capQuery(req.query.search as string | undefined);

    const isAdmin = authReq.user?.role === Role.Admin;
    const isStaff = isAdmin || authReq.user?.role === Role.Staff;
    const items = await inventoryService.listItems(
      isAuthenticated ? status : undefined,
      category,
      search,
      {
        occasion,
        // Staff/Admin see the true stored status (full lifecycle management).
        // Customers get the transaction-derived effective status so a piece
        // that is currently rented out or overdue never reads as "Available".
        rawStatus: isStaff,
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
    const id = parseIdParam(req.params.id);
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
    const id = parseIdParam(req.params.id);

    // Strip sale fields for non-admins before the Staff field allow-list runs.
    assertSaleAdminOnly(req.body, req.user?.role);

    if (req.user?.role === Role.Staff) {
      const allowedFields = ['name', 'category', 'occasions', 'price', 'description', 'size', 'image', 'status', 'outOfServiceReason'];
      const attemptedFields = Object.keys(req.body);
      const disallowed = attemptedFields.filter(f => !allowedFields.includes(f));
      if (disallowed.length > 0) {
        throw new AppError(403, `Staff cannot update fields: ${disallowed.join(', ')}`);
      }
    }

    const item = await inventoryService.updateItem(id, req.body, req.user?.id ?? undefined);
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function deleteItem(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
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

export async function bulkSaleUpdate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    assertSaleAdminOnly(req.body, req.user.role);
    const result = await inventoryService.bulkUpdateSale(
      req.body.ids,
      {
        onSale: req.body.onSale,
        discountPct: req.body.discountPct,
        salePrice: req.body.salePrice,
        saleEndsAt: req.body.saleEndsAt,
      },
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
    const id = parseIdParam(req.params.id);
    const result = await inventoryService.getBlockedDates(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
