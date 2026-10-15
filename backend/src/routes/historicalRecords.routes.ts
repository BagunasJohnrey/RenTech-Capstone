import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { Role } from '../types/index.js';
import * as recordsController from '../controllers/historicalRecords.controller.js';

const router = Router();

// Staff + Admin: importing logbook history is routine boutique work (staff
// transcribe paper records), and the table is analytical-only — it can never
// disturb live rentals, revenue or reminders.
router.use(authMiddleware, requireRole(Role.Admin, Role.Staff));

// Imports are cheap but bursty file parsing: 10 imports / 10 min per IP.
const importLimiter = createRateLimiter(10, 10 * 60_000);

router.post('/import', importLimiter, validate(recordsController.importSchema), recordsController.importRecords);
router.get('/', validate(recordsController.listSchema), recordsController.listRecords);
router.get('/stats', recordsController.getRecordStats);
router.delete('/:id', recordsController.deleteRecord);

export default router;
