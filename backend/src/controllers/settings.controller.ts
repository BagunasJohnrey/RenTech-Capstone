import { Response, NextFunction } from 'express';
import { z } from 'zod';
import * as settingsService from '../services/settings.service.js';
import * as geminiService from '../services/gemini.service.js';
import * as semaphoreService from '../services/semaphore.service.js';
import * as paymongoService from '../services/paymongo.service.js';
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
    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
}

export async function updateTemplate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const template = await settingsService.updateSmsTemplate(String(req.params.id), req.body);
    res.json(template);
  } catch (err) {
    next(err);
  }
}

export async function deleteTemplate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const result = await settingsService.deleteSmsTemplate(String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// Admin "System Integrations" status — live-probes Gemini, Semaphore,
// PayMongo, and Brevo in parallel (each with its own timeout) so one down
// service can't delay or mask the others. Never throws; each provider reports
// its own status.
export async function getIntegrationsStatus(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const [ai, semaphore, paymongo, brevo] = await Promise.all([
      geminiService.checkAiHealth(),
      semaphoreService.checkSemaphoreHealth(),
      paymongoService.checkPaymongoHealth(),
      brevoService.checkBrevoHealth(),
    ]);
    // The AI health probe covers all three model providers (gemini → groq →
    // openrouter); expose each under its own key so the UI can show one row
    // per provider.
    res.json({
      gemini: ai,
      groq: ai.providers?.groq,
      openrouter: ai.providers?.openrouter,
      semaphore,
      paymongo,
      brevo,
    });
  } catch (err) {
    next(err);
  }
}
