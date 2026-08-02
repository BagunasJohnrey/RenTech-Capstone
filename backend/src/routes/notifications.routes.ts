import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import * as notificationController from '../controllers/notifications.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/', notificationController.listNotifications);
router.put('/read-all', notificationController.markAllAsRead);
router.get('/unread-count', notificationController.getUnreadCount);
router.put('/:id/read', notificationController.markAsRead);

export default router;
