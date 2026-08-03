import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as transactionController from '../controllers/transactions.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/upcoming', requireRole(Role.Admin, Role.Staff), transactionController.getUpcomingReturns);

router.get('/', transactionController.listTransactions);
router.get('/:id', transactionController.getTransaction);

router.post('/', requireRole(Role.Admin, Role.Staff, Role.Customer), validate(transactionController.createRentalSchema), transactionController.createRental);
router.put('/:id/release', requireRole(Role.Admin, Role.Staff), validate(transactionController.releaseSchema), transactionController.releaseRental);
router.put('/:id/return', requireRole(Role.Admin, Role.Staff), validate(transactionController.returnSchema), transactionController.processReturn);
router.put('/:id/cancel', requireRole(Role.Admin, Role.Customer), transactionController.cancelTransaction);
router.patch('/:id', requireRole(Role.Admin, Role.Staff), validate(transactionController.updateTransactionSchema), transactionController.updateTransaction);
router.delete('/:id', requireRole(Role.Admin), transactionController.deleteTransaction);

export default router;
