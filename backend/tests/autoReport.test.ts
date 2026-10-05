import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

beforeEach(async () => {
  process.env.AI_REPORTS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'rentech-autoreport-'));
  process.env.AI_PROMO_SUGGESTIONS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'rentech-autopromo-'));
  vi.clearAllMocks();
});

describe('saveAiReport identical-save guard', () => {
  it('reuses the newest entry when content hashes match', async () => {
    const { saveAiReport, contentHash } = await import('../src/services/aiReport.service.js');
    const body = 'Executive Summary\nStable week.\nKey Performance Indicators';
    const first = await saveAiReport({ report: body, source: 'ai' });
    expect(first.skipped).toBeUndefined();
    expect(contentHash(body)).toBe(contentHash(`  ${body.replace(/\n/g, '\r\n')}  `));

    const second = await saveAiReport({ report: body, source: 'ai' });
    expect(second.skipped).toBe(true);
    expect(second.id).toBe(first.id);

    const files = await fs.readdir(process.env.AI_REPORTS_DIR!);
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('saves a new row when content differs', async () => {
    const { saveAiReport } = await import('../src/services/aiReport.service.js');
    const first = await saveAiReport({ report: 'Executive Summary\nStable week.' });
    const second = await saveAiReport({ report: 'Executive Summary\nBusy week with new bookings.' });
    expect(second.skipped).toBeUndefined();
    expect(second.id).not.toBe(first.id);
  });

  it('surfaces deduped on the manual generate-report response', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);

    // No AI keys in tests → static fallback stub; the controller saves every
    // non-error result, so both calls return the same body.
    const one = await request(app).post('/api/ai/generate-report').set('Authorization', 'Bearer admin-token');
    expect(one.status).toBe(200);
    expect(one.body).toHaveProperty('reportId');

    const two = await request(app).post('/api/ai/generate-report').set('Authorization', 'Bearer admin-token');
    expect(two.status).toBe(200);
    expect(two.body.reportId).toBe(one.body.reportId);
    expect(two.body.deduped).toBe(true);

    const listed = await request(app).get('/api/ai/reports').set('Authorization', 'Bearer admin-token');
    expect(listed.body).toHaveLength(1);
  });
});

describe('savePromoSuggestion identical-save guard', () => {
  it('reuses the newest entry when suggestions match', async () => {
    const { savePromoSuggestion } = await import('../src/services/aiPromoSuggestion.service.js');
    const suggestions = {
      itemSuggestions: [{ itemId: 1, itemName: 'Emerald Gown', discountPct: 25, suggestedExpiryDays: 30, rationale: 'Zero rentals.' }],
      voucherSuggestions: [],
    };
    const first = await savePromoSuggestion({ suggestions });
    expect(first.skipped).toBeUndefined();
    const second = await savePromoSuggestion({ suggestions });
    expect(second.skipped).toBe(true);
    expect(second.id).toBe(first.id);
  });
});

describe('runAutoReport (weekly scheduler)', () => {
  const FULL_REPORT = [
    'Executive Summary',
    'The boutique recorded stable rental activity with no overdue returns this period.',
    'Key Performance Indicators',
    'Active rentals are 10 with 0 overdue.',
    'Revenue Analysis',
    'No sales data available yet.',
    'Inventory & Utilization',
    'The catalog snapshot holds no items needing urgent action.',
    'Operational Health',
    'No overdue returns and no damaged items were recorded.',
    'Demand Forecast',
    'Projected rental volume is stable at current levels.',
    'Recommendations',
    '1. Run a category-themed promo week for slow-moving items to lift bookings.',
    '2. Feature the most-rented items at the storefront to capture walk-in demand.',
  ].join('\n');

  beforeEach(async () => {
    const { env } = await import('../src/config/env.js');
    env.GEMINI_API_KEY = 'test-key';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: FULL_REPORT }] } }] }),
    });
    const { prisma } = await import('../src/config/database.js');
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.businessRule.findUnique.mockResolvedValue(null);
    prisma.profile.findMany.mockResolvedValue([{ id: 'admin-id-789' }]);
  });

  async function restoreKeys() {
    const { env } = await import('../src/config/env.js');
    env.GEMINI_API_KEY = '';
  }

  it('saves the report, stamps the cadence rule, and notifies admins', async () => {
    const { runAutoReport, AUTO_REPORT_RULE, AUTO_REPORT_TYPE } = await import('../src/services/autoReport.service.js');
    const { prisma } = await import('../src/config/database.js');
    try {
      const res = await runAutoReport();
      expect(res.skipped).toBe(false);
      expect(res.id).toBeTruthy();

      expect(prisma.businessRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: AUTO_REPORT_RULE } })
      );
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            profileId: 'admin-id-789',
            type: AUTO_REPORT_TYPE,
            title: expect.stringContaining('Weekly business report'),
            message: expect.stringContaining(`report:${res.id}`),
          }),
        ],
      });
    } finally {
      await restoreKeys();
    }
  });

  it('skips while the last run is inside the 7-day window', async () => {
    const { runAutoReport } = await import('../src/services/autoReport.service.js');
    const { prisma } = await import('../src/config/database.js');
    try {
      prisma.businessRule.findUnique.mockResolvedValueOnce({ value: new Date().toISOString() });
      const res = await runAutoReport();
      expect(res.skipped).toBe(true);
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    } finally {
      await restoreKeys();
    }
  });

  it('runs again after the window expires (stale rule timestamp)', async () => {
    const { runAutoReport } = await import('../src/services/autoReport.service.js');
    const { prisma } = await import('../src/config/database.js');
    try {
      prisma.businessRule.findUnique.mockResolvedValueOnce({
        value: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const res = await runAutoReport();
      expect(res.skipped).toBe(false);
      expect(prisma.notification.createMany).toHaveBeenCalled();
    } finally {
      await restoreKeys();
    }
  });

  it('dedupes unchanged content: still stamps the rule, no new notification', async () => {
    const { runAutoReport } = await import('../src/services/autoReport.service.js');
    const { prisma } = await import('../src/config/database.js');
    try {
      const first = await runAutoReport();
      expect(first.skipped).toBe(false);

      // Second run with an expired window but identical generated content.
      prisma.businessRule.findUnique.mockResolvedValueOnce({
        value: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      });
      vi.clearAllMocks();
      prisma.businessRule.findUnique.mockResolvedValueOnce({
        value: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const second = await runAutoReport();
      expect(second.skipped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.id).toBe(first.id);
      expect(prisma.notification.createMany).not.toHaveBeenCalled();

      const files = await fs.readdir(process.env.AI_REPORTS_DIR!);
      expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(1);
    } finally {
      await restoreKeys();
    }
  });
});
