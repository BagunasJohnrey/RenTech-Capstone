import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { csrfGuard } from './middleware/csrfGuard.js';
import routes from './routes/index.js';
import webhookRoutes from './routes/webhooks.routes.js';
import { autoNotifyOverdue, notifyDueToday, notifyOverdue3Days, checkNoShowAndNotify } from './services/sms.service.js';
import { purgeOldData } from './services/retention.service.js';
import { ensureBucket } from './services/storage.service.js';
import { ensureBackupBucket, runAutoBackup } from './services/backup.service.js';
import { ensureAiReportsBucket } from './services/aiReport.service.js';
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
app.use(cookieParser());
app.use('/api', rateLimiter, routes);

// JSON 404 for unmatched API routes (must come before the error handler).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`);
  console.log(`[storage] Supabase URL: ${env.SUPABASE_URL}`);
  // The service key MUST carry role=service_role: with an anon key every
  // service-role path (storage uploads, auth.admin.*) fails confusingly
  // (e.g. RLS violations on backup uploads). Claims only, never the secret.
  import('./config/supabase.js').then(
    ({ supabaseKeyRole }) => console.log(`[supabase] service key role: ${supabaseKeyRole()}`),
    () => {}
  );

  // Ensure the private image bucket exists so item-photo uploads can mint
  // signed URLs (otherwise generateUploadUrl throws "Failed to generate upload URL").
  ensureBucket()
    .then(async () => {
      // Quick startup sanity: verify the bucket has files and signed URLs work.
      // NOTE: root listing can return folder placeholders (e.g. "rental/" —
      // the private bucket now only holds `rental/` condition shots), which
      // have id == null and can never be signed. Descend one level to find a
      // real file instead of signing the folder name (old code logged a
      // benign `FAIL (Object not found)` for "rental" on every boot).
      const { supabaseAdmin } = await import('./config/supabase.js');
      const bucket = process.env.STORAGE_BUCKET || 'rentech-images';
      const { data: files } = await supabaseAdmin.storage.from(bucket).list('', { limit: 10 });
      console.log(`[storage] bucket check (${bucket}): ${files?.length ?? 0} sample entries found`);
      let sample: string | null = null;
      for (const entry of files ?? []) {
        const rec = entry as { name?: string; id?: string | null };
        if (!rec?.name) continue;
        const isFolder = rec.id == null && !/\.[a-z0-9]+$/i.test(rec.name);
        if (!isFolder) { sample = rec.name; break; }
        const { data: inner } = await supabaseAdmin.storage.from(bucket).list(rec.name, { limit: 5 });
        const innerFile = (inner ?? []).find((e) => {
          const r = e as { name?: string; id?: string | null };
          return !!r?.name && r.id != null;
        }) as { name?: string } | undefined;
        if (innerFile?.name) { sample = `${rec.name}/${innerFile.name}`; break; }
      }
      if (sample) {
        const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(sample, 60);
        console.log(`[storage] signed URL test for "${sample}":`, error ? `FAIL (${error.message})` : 'OK');
      } else {
        console.log('[storage] signed URL test skipped — no sample file in bucket');
      }
    })
    .catch((err) => console.error('Storage bucket init failed:', err));

  // Ensure the private backup/report buckets right away (not only on the
  // delayed auto-backup tick) so manual backups upload from the first minute
  // instead of failing with "Bucket not found" after a fresh restart.
  ensureBackupBucket().catch((err) => console.error('Backup bucket init failed:', err));
  ensureAiReportsBucket().catch((err) => console.error('Reports bucket init failed:', err));

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

  // Phase 4.3 retention purge: sweep long-tail Notification/SentSms/AuditLog
  // rows older than `data_retention_months` once a day. Purging is idempotent
  // and low-cost, but still kept out of the 60s SMS cron so an accidental
  // misconfiguration can't widen its blast radius; the coarse daily cadence is
  // plenty given chains of months-long data. Guarded against overlap the same
  // way as the SMS scheduler so two ticks can't race the same deleteMany.
  let retentionRunning = false;
  const runRetention = async () => {
    if (retentionRunning) return;
    retentionRunning = true;
    try {
      const result = await purgeOldData();
      console.log(
        `[Retention] purged ${result.notifications} notification(s), ` +
        `${result.sentSms} sms record(s), ${result.auditLogs} audit log(s) older than ` +
        `${result.retentionMonths} month(s)`
      );
    } catch (err) {
      console.error('[Retention] purge failed:', err);
    } finally {
      retentionRunning = false;
    }
  };
  // Run once shortly after startup (staggered so it doesn't compete with the
  // dashboard pre-warm + the first SMS tick), then every 24 hours.
  const retentionStart = setTimeout(() => {
    runRetention();
    const daily = setInterval(runRetention, 24 * 60 * 60 * 1000);
    daily.unref?.();
  }, 5 * 60 * 1000);
  retentionStart.unref?.();

  // Automatic daily backup to the private `rentech-backups` bucket (the copy
  // that survives ephemeral disks). Same overlap guard + daily cadence as the
  // retention purge; runAutoBackup itself skips when the last successful run
  // (persisted in BusinessRule) was within 24h, so restarts never double-run.
  // The buckets are ensured here so a fresh Supabase project self-provisions.
  let autoBackupRunning = false;
  const runAutoBackupTick = async () => {
    if (autoBackupRunning) return;
    autoBackupRunning = true;
    try {
      await ensureBackupBucket();
      await ensureAiReportsBucket();
      await runAutoBackup();
    } catch (err) {
      console.error('[AutoBackup] tick failed:', err);
    } finally {
      autoBackupRunning = false;
    }
  };
  const autoBackupStart = setTimeout(() => {
    runAutoBackupTick();
    const daily = setInterval(runAutoBackupTick, 24 * 60 * 60 * 1000);
    daily.unref?.();
  }, 10 * 60 * 1000);
  autoBackupStart.unref?.();

  // Keep Render free tier alive: ping the health endpoint every 8 minutes so
  // the server never sleeps. Only needed in production (dev is always warm).
  if (env.NODE_ENV === 'production') {
    const keepAlive = setInterval(async () => {
      try {
        const host = process.env.RENDER_INTERNAL_HOSTNAME || '127.0.0.1';
        const port = env.PORT;
        await fetch(`http://${host}:${port}/api/health`);
      } catch { /* self-ping — best effort */ }
    }, 8 * 60 * 1000);
    keepAlive.unref?.();
  }
});

export default app;
