import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as settingsService from '../services/settings.service.js';
import * as backupService from '../services/backup.service.js';
import * as restoreService from '../services/restore.service.js';
import { createAuditLog } from '../utils/audit.js';
import * as geminiService from '../services/gemini.service.js';
import * as semaphoreService from '../services/semaphore.service.js';
import * as paymongoService from '../services/paymongo.service.js';
import * as mayaService from '../services/maya.service.js';
import * as brevoService from '../services/brevo.service.js';
import { AuthenticatedRequest } from '../types/index.js';

export const updateRulesSchema = z.object({
  body: z.record(z.string(), z.string()),
});

export const createTemplateSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100),
    content: z.string().min(1).max(1600),
    isDefault: z.boolean().optional(),
  }),
});

export const updateTemplateSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    content: z.string().min(1).max(1600).optional(),
    isDefault: z.boolean().optional(),
  }),
});

export async function getRules(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const rules = await settingsService.getBusinessRules();
    res.json(rules);
  } catch (err) {
    next(err);
  }
}

// Non-sensitive feature flags (UI toggles) readable by any authenticated role.
export async function getFeatureFlags(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const flags = await settingsService.getFeatureFlags();
    res.json(flags);
  } catch (err) {
    next(err);
  }
}

// Public rental-suggestion defaults (rental period + min downpayment) for
// booking flows — no auth required.
export async function getRentalDefaults(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const defaults = await settingsService.getRentalDefaults();
    res.json(defaults);
  } catch (err) {
    next(err);
  }
}

export async function updateRules(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await settingsService.updateBusinessRules(req.body);
    try {
      await createAuditLog({
        action: 'settings.rules.update', entity: 'settings', entityId: 'rental-rules',
        performedById: req.user?.id ?? null,
        newValue: req.body ?? {},
      });
    } catch {
      // audit is best-effort — never fail the save because of it
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listTemplates(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const templates = await settingsService.listSmsTemplates();
    res.json(templates);
  } catch (err) {
    next(err);
  }
}

export async function createTemplate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const template = await settingsService.createSmsTemplate(req.body);
    try {
      await createAuditLog({
        action: 'settings.sms-template.create', entity: 'sms-template',
        entityId: String((template as { id?: unknown })?.id ?? ''),
        performedById: req.user?.id ?? null,
        newValue: req.body ?? {},
      });
    } catch {
      // audit is best-effort
    }
    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
}

export async function updateTemplate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const template = await settingsService.updateSmsTemplate(String(req.params.id), req.body);
    try {
      await createAuditLog({
        action: 'settings.sms-template.update', entity: 'sms-template',
        entityId: String(req.params.id),
        performedById: req.user?.id ?? null,
        newValue: req.body ?? {},
      });
    } catch {
      // audit is best-effort
    }
    res.json(template);
  } catch (err) {
    next(err);
  }
}

export async function deleteTemplate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await settingsService.deleteSmsTemplate(String(req.params.id));
    try {
      await createAuditLog({
        action: 'settings.sms-template.delete', entity: 'sms-template',
        entityId: String(req.params.id),
        performedById: req.user?.id ?? null,
      });
    } catch {
      // audit is best-effort
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// Admin one-click JSON backup (Data & Backups tab). The full-table dump is
// collected live from Prisma, written to backend/data/backups/, and the
// metadata is returned so the UI can refresh its "last backups" list.
// Audited (backup.create) — exports carry customer PII.
export async function createBackup(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const meta = await backupService.createBackup(req.user?.id ?? null);
    try {
      await createAuditLog({
        action: 'backup.create', entity: 'backup', entityId: meta.id,
        performedById: req.user?.id ?? null,
        newValue: { totalRows: meta.totalRows, storageFiles: meta.storageFiles },
      });
    } catch {
      // audit is best-effort — never fail the backup because of it
    }
    res.status(201).json(meta);
  } catch (err) {
    next(err);
  }
}

export async function listBackups(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    res.json(await backupService.listBackups());
  } catch (err) {
    next(err);
  }
}

export async function downloadBackup(req: AuthenticatedRequest, res: Response, next: NextFunction) {  try {
    const id = String(req.params.id);
    try {
      await createAuditLog({
        action: 'backup.download', entity: 'backup', entityId: id,
        performedById: req.user?.id ?? null,
      });
    } catch {
      // audit is best-effort
    }
    // Local file first (fast path); cloud copy as fallback so downloads keep
    // working after a restart on ephemeral disks.
    try {
      const filePath = await backupService.getBackupPath(id);
      res.download(filePath, `${id}.json`);
      return;
    } catch {
      // fall through to cloud
    }
    const bytes = await backupService.getBackupBytes(id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.json"`);
    res.send(bytes);
  } catch (err) {
    next(err);
  }
}

// Retry pushing a "server only" backup to the cloud (Admin + MFA). Returns
// the updated meta on success; 502 with a check-the-logs message when the
// cloud copy still won't land.
export async function retryBackupUpload(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const meta = await backupService.uploadExistingBackup(String(req.params.id));
    try {
      await createAuditLog({
        action: 'backup.upload', entity: 'backup', entityId: meta.id,
        performedById: req.user?.id ?? null,
      });
    } catch {
      // audit is best-effort
    }
    res.json(meta);
  } catch (err) {
    next(err);
  }
}

export const importBackupSchema = z.object({
  body: z.object({
    payload: z.object({
      version: z.number().optional(),
      id: z.string().max(120).optional(),
      createdAt: z.string().max(40).optional(),
      tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(5000)),
    }),
  }),
});

// Admin restore from a previously downloaded backup file. Validates +
// upserts rows in FK order (see restore.service for the safety rules) and
// audits the outcome (backup.import with the per-table summary).
export async function importBackup(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const summary = await restoreService.restoreBackup(req.body.payload, req.user?.id ?? null);
    try {
      await createAuditLog({
        action: 'backup.import', entity: 'backup',
        entityId: typeof req.body.payload?.id === 'string' ? req.body.payload.id : 'upload',
        performedById: req.user?.id ?? null,
        newValue: summary,
      });
    } catch {
      // audit is best-effort
    }
    res.json(summary);
  } catch (err) {
    next(err);
  }
}

// Admin "System Integrations" status — live-probes Gemini, Semaphore,
// PayMongo, and Brevo in parallel (each with its own timeout) so one down
// service can't delay or mask the others. Never throws; each provider reports
// its own status.
//
// Short server-side cache: each check fans out to 6 external probes, so the
// result is memoized for 60s and served with the `checkedAt` of the actual
// probe. `?fresh=1` forces a live re-probe (manual Refresh button). Disabled
// under NODE_ENV=test so tests never see a stale probe.
let integrationsCache: { at: number; body: Record<string, unknown> } | null = null;
const INTEGRATIONS_CACHE_MS = 60_000;

export async function getIntegrationsStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const fresh = (req.query as Record<string, unknown> | undefined)?.fresh === '1'
      || (req.query as Record<string, unknown> | undefined)?.fresh === 'true';
    if (
      !fresh
      && integrationsCache
      && Date.now() - integrationsCache.at < INTEGRATIONS_CACHE_MS
      && process.env.NODE_ENV !== 'test'
    ) {
      return res.json({ ...integrationsCache.body });
    }
const [ai, semaphore, paymongo, maya, brevo, smsEnabled, emailEnabled] = await Promise.all([
    geminiService.checkAiHealth(),
    semaphoreService.checkSemaphoreHealth(),
    paymongoService.checkPaymongoHealth(),
    mayaService.checkMayaHealth(),
    brevoService.checkBrevoHealth(),
    settingsService.isSmsEnabled(),
    settingsService.isEmailEnabled(),
   ]);
    // The AI health probe covers all three model providers (gemini → groq →
    // openrouter); expose each under its own key so the UI can show one row
    // per provider. `enabled` carries the admin global kill-switch so the UI
    // can badge Semaphore/Brevo as Disabled (effective send = global AND
    // per-account pref).
    const body = {
      gemini: ai,
      groq: ai.providers?.groq,
      openrouter: ai.providers?.openrouter,
      semaphore: { ...semaphore, enabled: smsEnabled },
   paymongo,
   maya,
   brevo: { ...brevo, enabled: emailEnabled },
      checkedAt: new Date().toISOString(),
    };
    integrationsCache = { at: Date.now(), body };
    res.json(body);
  } catch (err) {
    next(err);
  }
}
