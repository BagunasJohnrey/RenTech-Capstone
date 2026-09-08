import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as transactionController from '../controllers/transactions.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/upcoming', requireRole(Role.Admin, Role.Staff), transactionController.getUpcomingReturns);

// QR scan lookup — admin/staff only; static segment registered before `/:id`
// so "scan" is never parsed as a transaction id.
router.get('/scan/:id', requireRole(Role.Admin, Role.Staff), transactionController.scanTransaction);

router.get('/', transactionController.listTransactions);
router.get('/:id', transactionController.getTransaction);

// Customers book exclusively through /bookings (which enforces the 50%
// minimum downpayment + server-side pricing). Allowing them to POST here
// would bypass those guards, so rental creation is staff/admin only.
router.post('/', requireRole(Role.Admin, Role.Staff), validate(transactionController.createRentalSchema), transactionController.createRental);
router.post('/:id/payments', requireRole(Role.Admin, Role.Staff), validate(transactionController.recordPaymentSchema), transactionController.recordPayment);
router.put('/:id/release', requireRole(Role.Admin, Role.Staff), validate(transactionController.releaseSchema), transactionController.releaseRental);
router.put('/:id/return', requireRole(Role.Admin, Role.Staff), validate(transactionController.returnSchema), transactionController.processReturn);
router.put('/:id/cancel', requireRole(Role.Admin, Role.Customer), transactionController.cancelTransaction);
router.patch('/:id', requireRole(Role.Admin, Role.Staff), validate(transactionController.updateTransactionSchema), transactionController.updateTransaction);
router.delete('/:id', requireRole(Role.Admin), transactionController.deleteTransaction);

export default router;
