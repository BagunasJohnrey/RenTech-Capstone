import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { Role } from '../types/index.js';
import * as customerController from '../controllers/customer.controller.js';
import * as paymentProofsController from '../controllers/paymentProofs.controller.js';

const catalogRouter = Router();
const bookingRouter = Router();
const customerRouter = Router();

catalogRouter.get('/', customerController.getCatalog);
catalogRouter.get('/:id', customerController.getCatalogItem);

bookingRouter.use(authMiddleware, requireRole(Role.Customer));
bookingRouter.post('/', validate(customerController.createBookingSchema), customerController.createBooking);
bookingRouter.post(
  '/:id/payment-proof',
  createRateLimiter(10, 3_600_000),
  validate(paymentProofsController.submitProofSchema),
  paymentProofsController.submitProof,
);
bookingRouter.get('/', customerController.getBookings);
bookingRouter.get('/:id', customerController.getBookingDetail);

// Admin/Staff edit a customer's contact details (name/phone/address/prefs).
customerRouter.put('/:id', authMiddleware, requireRole(Role.Admin, Role.Staff), validate(customerController.updateCustomerSchema), customerController.updateCustomer);

// Customer messages the boutique team (e.g. cancellation request for a
// booking they can't cancel themselves). Rate-limited against spam.
customerRouter.post('/contact', authMiddleware, requireRole(Role.Customer), createRateLimiter(5, 60_000), validate(customerController.contactAdminSchema), customerController.contactAdmin);

export { catalogRouter, bookingRouter, customerRouter };
