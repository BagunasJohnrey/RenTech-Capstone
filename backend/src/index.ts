import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import routes from './routes/index.js';
import webhookRoutes from './routes/webhooks.routes.js';
import { autoNotifyOverdue, notifyDueToday } from './services/sms.service.js';
import { ensureBucket } from './services/storage.service.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use('/api/webhooks', express.raw({ type: 'application/json' }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    (req as unknown as { rawBody: string }).rawBody = req.body.toString('utf-8');
    try {
      req.body = JSON.parse(req.body.toString('utf-8'));
    } catch {
      req.body = {};
    }
  }
  next();
}, webhookRoutes);

app.use(express.json({ limit: '25mb' }));

app.use('/api', rateLimiter, routes);

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`);

  // Ensure the private image bucket exists so item-photo uploads can mint
  // signed URLs (otherwise generateUploadUrl throws "Failed to generate upload URL").
  ensureBucket().catch((err) => console.error('Storage bucket init failed:', err));

  // Check for overdue / due-today transactions every 5 minutes
  const runScheduledChecks = () => {
    autoNotifyOverdue().then(results => {
      if (results.length > 0) {
        console.log(`[Overdue] Processed ${results.length} overdue transaction(s)`);
      }
    });
    notifyDueToday().then(results => {
      if (results.length > 0) {
        console.log(`[Due Today] Flagged ${results.length} transaction(s) due today`);
      }
    });
  };
  runScheduledChecks();
  setInterval(runScheduledChecks, 5 * 60 * 1000);
});

export default app;
