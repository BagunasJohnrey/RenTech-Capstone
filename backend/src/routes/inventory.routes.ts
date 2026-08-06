import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { requireRole, requireMfaAdmin } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as inventoryController from '../controllers/inventory.controller.js';
import * as analyticsController from '../controllers/inventoryAnalytics.controller.js';

const router = Router();

// Public, read-only endpoints (guests can browse the catalog + check dates
// before signing up). Writes below stay protected by authMiddleware+requireRole.
router.get('/availability', validate(inventoryController.availabilitySchema), inventoryController.checkAvailability);
router.get('/blocked-dates/:id', inventoryController.getBlockedDates);

// Admin-only analytics with MFA enforcement
router.get('/analytics', authMiddleware, requireRole(Role.Admin), requireMfaAdmin, analyticsController.getInventoryAnalytics);

// Optional auth: guests browse the public catalog, but logged-in staff/admin
// receive the full raw catalog (incl. Deleted/OutOfService statuses).
router.get('/', optionalAuthMiddleware, inventoryController.listItems);
router.get('/:id', optionalAuthMiddleware, inventoryController.getItem);

router.post('/', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(inventoryController.createItemSchema), inventoryController.createItem);
router.put('/:id', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(inventoryController.updateItemSchema), inventoryController.updateItem);
router.delete('/:id', authMiddleware, requireRole(Role.Admin), inventoryController.deleteItem);

// Bulk lifecycle status change (marking a batch of cleaned items Available,
// or taking a batch out of service). Admin + Staff only.
router.patch('/bulk-status', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(inventoryController.bulkStatusSchema), inventoryController.bulkSetStatus);

export default router;
