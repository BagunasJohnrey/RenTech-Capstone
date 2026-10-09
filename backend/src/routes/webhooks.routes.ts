import { Router } from 'express';
import * as webhooksController from '../controllers/webhooks.controller.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// I5: /api/webhooks is mounted BEFORE the global limiter in index.ts, so the
// Maya route needs its own per-IP budget. Every SUCCESS event makes an
// authenticated outbound call with the merchant secret key, so an unauthenticated
// flood would exhaust the very API quota the secret-key re-check depends on —
// DoS on the trust anchor itself. PayMongo exits at the HMAC check before any
// outbound call, so it doesn't need this.
const mayaWebhookLimiter = createRateLimiter(60, 60_000);

router.post('/paymongo', webhooksController.handlePayMongoWebhook);
router.post('/maya', mayaWebhookLimiter, webhooksController.handleMayaWebhook);

export default router;
