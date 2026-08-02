import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { Role } from '../types/index.js';
import * as customerController from '../controllers/customer.controller.js';

const catalogRouter = Router();
const bookingRouter = Router();

catalogRouter.get('/', customerController.getCatalog);
catalogRouter.get('/:id', customerController.getCatalogItem);

bookingRouter.use(authMiddleware, requireRole(Role.Customer));
bookingRouter.post('/', validate(customerController.createBookingSchema), customerController.createBooking);
bookingRouter.get('/', customerController.getBookings);
bookingRouter.get('/:id', customerController.getBookingDetail);

export { catalogRouter, bookingRouter };
