import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as inventoryService from '../services/inventory.service.js';
import * as transactionService from '../services/transactions.service.js';
import * as promoService from '../services/promoCodes.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const createBookingSchema = z.object({
  body: z.object({
    itemId: z.number().int().positive(),
    rentalDate: z.string(),
    dueDate: z.string(),
    rentalFee: z.number().positive(),
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
    const item = await inventoryService.getItem(id);
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function createBooking(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const { itemId, rentalDate, dueDate, rentalFee, downpayment, notes, promoCode, size, measurements } = req.body;

    // FIX B: apply the promo discount server-side and link it to the transaction.
    let finalRentalFee = rentalFee;
    let promoCodeId: string | undefined;
    if (promoCode) {
      const promo = await promoService.validateAndApply(promoCode, rentalFee);
      finalRentalFee = promo.finalFee;
      promoCodeId = promo.promoCodeId;
    }

    const tx = await transactionService.createRental({
      customerId: req.user.id,
      itemId,
      rentalDate,
      dueDate,
      rentalFee: finalRentalFee,
      downpayment,
      notes,
      promoCodeId,
      size,
      measurements,
    });

    res.status(201).json(tx);
  } catch (err) {
    next(err);
  }
}

export async function getBookings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');

    const result = await transactionService.listTransactions({
      role: 'Customer',
      profileId: req.user.id,
      status: req.query.status as string | undefined,
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
