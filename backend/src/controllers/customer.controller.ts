import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as inventoryService from '../services/inventory.service.js';
import * as transactionService from '../services/transactions.service.js';
import * as customerService from '../services/customer.service.js';
import { createAuditLog } from '../utils/audit.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const createBookingSchema = z.object({
  body: z.object({
    itemId: z.number().int().positive(),
    rentalDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid rental date'),
    dueDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid due date'),
    downpayment: z.number().min(0).optional(),
    notes: z.string().optional(),
    promoCode: z.string().optional(),
    size: z.string().optional(),
    measurements: z.record(z.any()).optional(),
  }),
});

export async function getCatalog(req: Request, res: Response, next: NextFunction) {
  try {
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const items = await inventoryService.listItems('Available', category, search);
    res.json(items);
  } catch (err) {
    next(err);
  }
}

export async function getCatalogItem(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid item id');
    const item = await inventoryService.getItem(id);
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function createBooking(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    // SECURITY: the rental price is NEVER taken from the client. It is derived
    // server-side from the item (sale-aware) in transactions.service.createRental;
    // only an optional promo code is accepted, and it is resolved server-side.
    const { itemId, rentalDate, dueDate, downpayment, notes, promoCode, size, measurements } = req.body;

    const tx = await transactionService.createRental({
      customerId: req.user.id,
      itemId,
      rentalDate,
      dueDate,
      downpayment,
      notes,
      promoCode,
      size,
      measurements,
      requireMinimumDownpayment: true, // customers must pay the 50% downpayment
    });

    res.status(201).json(tx);
  } catch (err) {
    next(err);
  }
}

const TX_STATUSES = ['Active', 'Reserved', 'Overdue', 'Returned', 'Late', 'Cancelled', 'Completed'] as const;

export async function getBookings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const status = req.query.status as string | undefined;
    if (status !== undefined && !TX_STATUSES.includes(status as (typeof TX_STATUSES)[number])) {
      throw new AppError(400, `Invalid status filter: ${status}`);
    }

    const result = await transactionService.listTransactions({
      role: 'Customer',
      profileId: req.user.id,
      status,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getBookingDetail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const tx = await transactionService.getTransaction(String(req.params.id));

    if (tx.customerId !== req.user.id) {
      throw new AppError(403, 'You can only view your own bookings');
    }

    res.json(tx);
  } catch (err) {
    next(err);
  }
}

// Admin/Staff: update a customer's contact details (name/phone/address/prefs).
// Scoped to non-fee contact fields only — item/fee changes stay cancel+rebook.
export const updateCustomerSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    preferences: z.array(z.string()).optional().nullable(),
  }),
});

export async function updateCustomer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const customer = await customerService.updateCustomer(String(req.params.id), req.body);
    // Audit: who/what changed (performedById = the staff/admin making the edit)
    try {
      await createAuditLog({
        action: 'update',
        entity: 'customer',
        entityId: customer.id,
        performedById: req.user.id,
        newValue: req.body,
      });
    } catch { /* audit is non-critical */ }
    res.json(customer);
  } catch (err) {
    next(err);
  }
}
