import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import routes from './routes/index.js';
import webhookRoutes from './routes/webhooks.routes.js';
import { autoNotifyOverdue, notifyDueToday, notifyOverdue3Days, checkNoShowAndNotify } from './services/sms.service.js';
import { ensureBucket } from './services/storage.service.js';
import { getKpis, getForecast, getInsights, getTodayTasks } from './services/dashboard.service.js';
import { getInventoryAnalytics } from './services/inventoryAnalytics.service.js';

const app = express();

// Trust the first proxy hop (host/load-balancer) so req.protocol reflects the
// public scheme, which the HTTPS redirect + HSTS rely on.
app.set('trust proxy', 1);

// Production: force HTTPS (skip the health-check so load-balancers can probe
// over HTTP). Placed BEFORE helmet so helmet's HSTS only ever sees a secure
// request. Dev stays plain HTTP.
app.use((req, res, next) => {
  if (env.NODE_ENV !== 'production') return next();
  // Health probe exempt (load balancers probe over HTTP). Trust the proxy's
  // forwarded scheme when present; when there's no proxy, the socket itself
  // tells us whether TLS terminated here.
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? (req.secure ? 'https' : 'http')).split(',')[0].trim().toLowerCase();
  if (req.path === '/api/health' || forwardedProto === 'https') return next();
  const host = req.headers.host;
  res.redirect(301, `https://${host}${req.originalUrl}`);
});

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: {
    directives: {
      // API serves JSON only — no scripts, styles, images or frames needed.
      // This also kills a whole class of HTML-injection/reflected-XSS on API
      // responses. The SPA (Vite) sets its own CSP for the browser assets.
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(requestId);
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

// JSON 404 for unmatched API routes (must come before the error handler).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`);

  // Ensure the private image bucket exists so item-photo uploads can mint
  // signed URLs (otherwise generateUploadUrl throws "Failed to generate upload URL").
  ensureBucket().catch((err) => console.error('Storage bucket init failed:', err));

  // Pre-warm the dashboard cache so the first page load (AI Insights, KPIs,
  // revenue charts) is a cache hit instead of paying the cold-connection +
  // multi-query cost in front of the user. Errors are non-fatal — the page
  // just computes on first request as usual.
  Promise.allSettled([
    getKpis(),
    getForecast(3),
    getInsights(),
    getInventoryAnalytics(),
    getTodayTasks(),
  ]).then(() => console.log('[Cache] dashboard data pre-warmed'));

  // Check for overdue / due-today transactions every 1 minute so SMS
  // reminders go out within ~60s of the relevant date boundary.
  // C4: never run two passes concurrently — a slow SMS batch (Semaphore
  // latency) colliding with the next 60-second tick would double-send
  // billable reminders (overdue/due-today/no-show all share this cron).
  let scheduledChecksRunning = false;
  const runScheduledChecks = async () => {
    if (scheduledChecksRunning) return;
    scheduledChecksRunning = true;
    try {
      const results = await Promise.allSettled([
        autoNotifyOverdue().then((overdue) => {
          if (overdue.length > 0) {
            console.log(`[Overdue] Processed ${overdue.length} overdue transaction(s)`);
          }
        }),
        notifyOverdue3Days().then((esc) => {
          if (esc.length > 0) {
            console.log(`[Overdue+3d] Escalated ${esc.length} long-overdue rental(s)`);
          }
        }),
        notifyDueToday().then((dueToday) => {
          if (dueToday.length > 0) {
            console.log(`[Due Today] Flagged ${dueToday.length} transaction(s) due today`);
          }
        }),
        checkNoShowAndNotify().then((noShows) => {
          if (noShows.length > 0) {
            console.log(`[No-Show] Flagged ${noShows.length} no-show pickup(s)`);
          }
        }),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') console.error('[Scheduler] job error:', r.reason);
      }
    } finally {
      scheduledChecksRunning = false;
    }
  };
  runScheduledChecks();
  const scheduler = setInterval(runScheduledChecks, 60 * 1000);
  scheduler.unref?.();
});

export default app;
