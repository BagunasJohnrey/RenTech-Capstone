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

let backupDir: string;
let reportsDir: string;

beforeEach(async () => {
  backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rentech-backups-'));
  reportsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rentech-reports-'));
  process.env.BACKUP_DATA_DIR = backupDir;
  process.env.AI_REPORTS_DIR = reportsDir;
  vi.clearAllMocks();
});

describe('Backups API (admin)', () => {
  it('lists empty history initially', async () => {
    const res = await request(app)
      .get('/api/settings/backups')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('creates a backup and lists it', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.profile.findMany.mockResolvedValueOnce([{ id: 'p1' }]);
    prisma.inventoryItem.findMany.mockResolvedValueOnce([{ id: 1 }]);

    const created = await request(app)
      .post('/api/settings/backups')
      .set('Authorization', 'Bearer admin-token');
    expect(created.status).toBe(201);
    expect(created.body).toHaveProperty('id');
    expect(created.body.totalRows).toBeGreaterThanOrEqual(2);
    // Storage manifest is always present (metadata only, never binaries).
    expect(created.body).toHaveProperty('storageFiles');
    expect(created.body).toHaveProperty('storageBytes');

    const listed = await request(app)
      .get('/api/settings/backups')
      .set('Authorization', 'Bearer admin-token');
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(created.body.id);
    expect(listed.body[0]).toHaveProperty('storageFiles');
  });

  it('writes a storage manifest into the backup file', async () => {
    const created = await request(app)
      .post('/api/settings/backups')
      .set('Authorization', 'Bearer admin-token');
    expect(created.status).toBe(201);

    const raw = await fs.readFile(path.join(backupDir, `${created.body.id}.json`), 'utf8');
    const payload = JSON.parse(raw);
    expect(payload.version).toBe(2);
    expect(payload.storage).toHaveProperty('files');
    expect(Array.isArray(payload.storage.files)).toBe(true);
    expect(payload.storage).toHaveProperty('fileCount');
    expect(payload.storage).toHaveProperty('incomplete');
  });

  it('collectStorageManifest never throws when storage is unreachable', async () => {
    const { collectStorageManifest } = await import('../src/services/storage.service.js');
    const manifest = await collectStorageManifest(2000);
    expect(manifest).toHaveProperty('files');
    expect(manifest).toHaveProperty('fileCount');
    // Test env has no storage client (mocked supabase without storage) —
    // must resolve empty, not throw or hit the network.
    expect(manifest.files).toEqual([]);
    expect(manifest.fileCount).toBe(0);
  });

  it('downloads a created backup as JSON', async () => {
    const created = await request(app)
      .post('/api/settings/backups')
      .set('Authorization', 'Bearer admin-token');
    expect(created.status).toBe(201);

    const dl = await request(app)
      .get(`/api/settings/backups/${created.body.id}/download`)
      .set('Authorization', 'Bearer admin-token');
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain(created.body.id);
  });

  it('404s on unknown backup id', async () => {
    const res = await request(app)
      .get('/api/settings/backups/nope-missing/download')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(404);
  });

  it('reports cloud status on created backups (no cloud in tests)', async () => {
    const created = await request(app)
      .post('/api/settings/backups')
      .set('Authorization', 'Bearer admin-token');
    expect(created.status).toBe(201);
    // Test env has no storage client — upload is skipped, never failed.
    expect(created.body.uploaded).toBe(false);
    expect(created.body.source).toBe('local');
  });

  it('404s when the local file is gone and there is no cloud copy', async () => {
    const created = await request(app)
      .post('/api/settings/backups')
      .set('Authorization', 'Bearer admin-token');
    expect(created.status).toBe(201);
    await fs.unlink(path.join(backupDir, `${created.body.id}.json`));

    const dl = await request(app)
      .get(`/api/settings/backups/${created.body.id}/download`)
      .set('Authorization', 'Bearer admin-token');
    expect(dl.status).toBe(404);
  });

  it('retry-upload 404s when the local file is gone', async () => {
    const res = await request(app)
      .post('/api/settings/backups/nope-missing/upload')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(404);
  });

  it('retry-upload reports cloud failure instead of hanging (no cloud in tests)', async () => {
    const created = await request(app)
      .post('/api/settings/backups')
      .set('Authorization', 'Bearer admin-token');
    expect(created.status).toBe(201);

    const res = await request(app)
      .post(`/api/settings/backups/${created.body.id}/upload`)
      .set('Authorization', 'Bearer admin-token');
    // Test env has no storage client — must fail fast with 502, not 500/timeout.
    expect(res.status).toBe(502);
  });

  it('retry-upload rejects staff and unauthenticated callers', async () => {
    const staff = await request(app)
      .post('/api/settings/backups/some-id/upload')
      .set('Authorization', 'Bearer staff-token');
    expect(staff.status).toBe(403);

    const anon = await request(app).post('/api/settings/backups/some-id/upload');
    expect(anon.status).toBe(401);
  });

  it('400s on path-traversal id', async () => {
    const res = await request(app)
      .get('/api/settings/backups/..%2Fsecret/download')
      .set('Authorization', 'Bearer admin-token');
    // Express may normalize the path; either 400 (our guard) or 404 is safe —
    // the point is no file outside the dir is served.
    expect([400, 404]).toContain(res.status);
  });

  it('rejects staff and unauthenticated callers', async () => {
    const staff = await request(app)
      .get('/api/settings/backups')
      .set('Authorization', 'Bearer staff-token');
    expect(staff.status).toBe(403);

    const anon = await request(app).get('/api/settings/backups');
    expect(anon.status).toBe(401);
  });
});

describe('AI report history (admin)', () => {  it('lists empty history initially', async () => {
    const res = await request(app)
      .get('/api/ai/reports')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('auto-saves generate-report output and reopens it', async () => {
    const { prisma } = await import('../src/config/database.js');
    // generateReport fans out to dashboard/inventory services — keep mocks empty.
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);

    // No AI keys in tests → fallback path returns a static message, which is
    // still saved to history (source fallback).
    const gen = await request(app)
      .post('/api/ai/generate-report')
      .set('Authorization', 'Bearer admin-token');
    expect(gen.status).toBe(200);
    expect(gen.body).toHaveProperty('report');
    expect(gen.body).toHaveProperty('reportId');

    const listed = await request(app)
      .get('/api/ai/reports')
      .set('Authorization', 'Bearer admin-token');
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(gen.body.reportId);
    expect(listed.body[0]).toHaveProperty('excerpt');

    const one = await request(app)
      .get(`/api/ai/reports/${gen.body.reportId}`)
      .set('Authorization', 'Bearer admin-token');
    expect(one.status).toBe(200);
    expect(one.body.report).toBe(gen.body.report);
  });

  it('404s on unknown report id and rejects non-admins', async () => {
    const missing = await request(app)
      .get('/api/ai/reports/rpt-missing')
      .set('Authorization', 'Bearer admin-token');
    expect(missing.status).toBe(404);

    const staff = await request(app)
      .get('/api/ai/reports')
      .set('Authorization', 'Bearer staff-token');
    expect(staff.status).toBe(403);

    const cust = await request(app)
      .post('/api/ai/generate-report')
      .set('Authorization', 'Bearer customer-token');
    expect(cust.status).toBe(403);
  });

  it('reports cloud status on saved reports (no cloud in tests)', async () => {
    const listed = await request(app)
      .get('/api/ai/reports')
      .set('Authorization', 'Bearer admin-token');
    expect(listed.status).toBe(200);
    for (const r of listed.body) {
      expect(r).toHaveProperty('uploaded');
      expect(r).toHaveProperty('origin');
    }
  });

  it('merges local and cloud report history correctly', async () => {
    const { mergeReportLists } = await import('../src/services/aiReport.service.js');
    const local = [
      { id: 'a', createdAt: '2026-01-02T00:00:00.000Z', uploaded: false, origin: 'local' },
      { id: 'b', createdAt: '2026-01-01T00:00:00.000Z', uploaded: false, origin: 'local' },
    ];
    const cloud = [
      { id: 'b', createdAt: '2026-01-01T00:00:00.000Z', uploaded: true, origin: 'cloud' },
      { id: 'c', createdAt: '2026-01-03T00:00:00.000Z', uploaded: true, origin: 'cloud' },
    ];
    const merged = mergeReportLists(local as never, cloud as never);
    expect(merged.map((m) => m.id)).toEqual(['c', 'a', 'b']);
    expect(merged.find((m) => m.id === 'b')?.origin).toBe('both');
    expect(merged.find((m) => m.id === 'c')?.origin).toBe('cloud');
    expect(merged.find((m) => m.id === 'a')?.origin).toBe('local');
  });
});

describe('POST /api/settings/backups/import (admin restore)', () => {
  const basePayload = () => ({
    version: 2,
    id: 'backup-test-1',
    tables: {
      business_rules: [{ key: 'late_penalty_per_day', value: '500' }],
      sms_templates: [{ id: 'tmpl-1', name: 'Reminder', content: 'Hi {customer}' }],
      profiles: [
        { id: 'customer-id-111', userId: 'auth-customer-id', email: 'customer@example.com', name: 'Customer User', role: 'Customer' },
      ],
      promo_codes: [{ id: 'promo-1', code: 'WELCOME10', discountPct: 10 }],
      inventory_items: [{ id: 7, name: 'Test Barong', category: 'Barong', price: 1500, status: 'Available' }],
      transactions: [{
        id: 'tx-test-1', customerId: 'customer-id-111', itemId: 7,
        rentalDate: new Date().toISOString(), dueDate: new Date(Date.now() + 86400000).toISOString(),
        status: 'Active', rentalFee: 1500, balance: 750,
      }],
      payments: [{ id: 'pay-test-1', transactionId: 'tx-test-1', amount: 750, method: 'Cash', type: 'downpayment' }],
      notifications: [{ id: 'notif-test-1', profileId: 'customer-id-111', type: 'info', title: 'Hi', message: 'Hello' }],
      sent_sms: [{ id: 'sms-test-1', profileId: 'customer-id-111', message: 'Hello' }],
      audit_logs: [{ id: 'log-test-1', action: 'test', entity: 'item', entityId: '7' }],
    },
  });

  it('restores all tables and audits the import', async () => {
    const { prisma } = await import('../src/config/database.js');
    // inventoryItem.findUnique is hit twice (item upsert check, then the
    // transaction FK check) — both must see the item.
    prisma.inventoryItem.findUnique
      .mockResolvedValueOnce({ id: 7, name: 'Test Barong' })
      .mockResolvedValueOnce({ id: 7, name: 'Test Barong' });
    // transaction.findUnique: create-path check (null) then payment FK check.
    prisma.transaction.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tx-test-1' });

    const res = await request(app)
      .post('/api/settings/backups/import')
      .set('Authorization', 'Bearer admin-token')
      .send({ payload: basePayload() });

    expect(res.status).toBe(200);
    expect(res.body.restored).toMatchObject({
      business_rules: 1, sms_templates: 1, profiles: 1, promo_codes: 1,
      inventory_items: 1, transactions: 1, payments: 1,
      notifications: 1, sent_sms: 1, audit_logs: 1,
    });
    expect(res.body.skipped).toEqual({});
    // Import itself is audited (plus the restored audit_logs row).
    expect(prisma.auditLog.create).toHaveBeenCalled();
    const auditCall = prisma.auditLog.create.mock.calls.find(
      (c) => (c[0] as { data: { action: string } }).data.action === 'backup.import'
    );
    expect(auditCall).toBeDefined();
  });

  it('round-trips payment proofs from a full backup payload', async () => {
    const { prisma } = await import('../src/config/database.js');
    // inventoryItem.findUnique: item upsert check, then the transaction FK check.
    prisma.inventoryItem.findUnique
      .mockResolvedValueOnce({ id: 7, name: 'Test Barong' })
      .mockResolvedValueOnce({ id: 7, name: 'Test Barong' });
    // transaction.findUnique: transaction create-path check, payment FK check,
    // then the payment-proof parent check.
    prisma.transaction.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tx-test-1' })
      .mockResolvedValueOnce({ id: 'tx-test-1' });

    const payload = basePayload();
    payload.tables.payment_proofs = [{
      id: 'proof-test-1', transactionId: 'tx-test-1', amount: 500,
      reference: 'REF-001', channel: 'instapay',
      imagePath: 'rental/proofs/proof-test-1.webp',
      status: 'approved', reviewedById: 'admin-id-789',
      reviewedAt: new Date().toISOString(),
    }];

    const res = await request(app)
      .post('/api/settings/backups/import')
      .set('Authorization', 'Bearer admin-token')
      .send({ payload });

    expect(res.status).toBe(200);
    expect(res.body.restored.payment_proofs).toBe(1);
    expect(res.body.skipped).toEqual({});
    // The restored row itself (not just the counter) carries the proof data.
    const proofCall = prisma.paymentProof.create.mock.calls.find(
      (c) => (c[0] as { data: { id: string } }).data.id === 'proof-test-1'
    );
    expect(proofCall).toBeDefined();
    expect((proofCall![0] as { data: Record<string, unknown> }).data).toMatchObject({
      transactionId: 'tx-test-1', amount: 500, reference: 'REF-001',
      channel: 'instapay', imagePath: 'rental/proofs/proof-test-1.webp',
      status: 'approved', reviewedById: 'admin-id-789', rejectionReason: null,
      reviewedAt: expect.any(String),
    });
  });

  it('skips payment proofs whose parent transaction is missing', async () => {
    const { prisma } = await import('../src/config/database.js');
    const res = await request(app)
      .post('/api/settings/backups/import')
      .set('Authorization', 'Bearer admin-token')
      .send({
        payload: {
          version: 2,
          tables: {
            payment_proofs: [{
              id: 'proof-orphan', transactionId: 'tx-missing', amount: 100,
              imagePath: 'rental/proofs/orphan.webp', status: 'pending',
            }],
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatchObject({ payment_proofs: 1 });
    expect(res.body.restored.payment_proofs).toBeUndefined();
    expect(prisma.paymentProof.create).not.toHaveBeenCalled();
  });

  it('never demotes the performing admin via a foreign backup', async () => {
    const { prisma } = await import('../src/config/database.js');
    const res = await request(app)
      .post('/api/settings/backups/import')
      .set('Authorization', 'Bearer admin-token')
      .send({
        payload: {
          version: 2,
          tables: {
            profiles: [
              { id: 'admin-id-789', userId: 'auth-admin-id-789', email: 'admin@example.com', name: 'Hacker', role: 'Customer' },
            ],
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.restored).toMatchObject({ profiles: 1 });
    const updateCall = prisma.profile.update.mock.calls.find(
      (c) => (c[0] as { where: { id: string } }).where.id === 'admin-id-789'
    );
    expect(updateCall).toBeDefined();
    expect((updateCall![0] as { data: { role: string } }).data.role).toBe('Admin');
  });

  it('skips rows with bad enums instead of failing the import', async () => {
    const payload = basePayload();
    payload.tables.inventory_items = [{ id: 9, name: 'Bad', category: 'Gown', price: 100, status: 'Broken' }];
    payload.tables.transactions = [];
    payload.tables.payments = [];

    const res = await request(app)
      .post('/api/settings/backups/import')
      .set('Authorization', 'Bearer admin-token')
      .send({ payload });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toMatchObject({ inventory_items: 1 });
    expect(res.body.restored.business_rules).toBe(1);
  });

  it('rejects garbage payloads with 400', async () => {
    const noPayload = await request(app)
      .post('/api/settings/backups/import')
      .set('Authorization', 'Bearer admin-token')
      .send({});
    expect(noPayload.status).toBe(400);

    const noTables = await request(app)
      .post('/api/settings/backups/import')
      .set('Authorization', 'Bearer admin-token')
      .send({ payload: { version: 2, tables: {} } });
    expect(noTables.status).toBe(400);

    const unknownOnly = await request(app)
      .post('/api/settings/backups/import')
      .set('Authorization', 'Bearer admin-token')
      .send({ payload: { version: 2, tables: { future_table: [{ a: 1 }] } } });
    expect(unknownOnly.status).toBe(400);
  });

  it('rejects staff and unauthenticated callers', async () => {
    const staff = await request(app)
      .post('/api/settings/backups/import')
      .set('Authorization', 'Bearer staff-token')
      .send({ payload: basePayload() });
    expect(staff.status).toBe(403);

    const anon = await request(app)
      .post('/api/settings/backups/import')
      .send({ payload: basePayload() });
    expect(anon.status).toBe(401);
  });
});

describe('Automatic daily backups', () => {
  it('runs when no previous auto-backup exists and audits it', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findUnique.mockResolvedValueOnce(null);

    const { runAutoBackup } = await import('../src/services/backup.service.js');
    const result = await runAutoBackup();

    expect(result.skipped).toBe(false);
    expect(result.id).toMatch(/^backup-/);
    expect(prisma.businessRule.upsert).toHaveBeenCalled();
    const auditCall = prisma.auditLog.create.mock.calls.find(
      (c) => (c[0] as { data: { action: string } }).data.action === 'backup.auto'
    );
    expect(auditCall).toBeDefined();
  });

  it('skips when the last auto-backup was within 24h', async () => {
    const { prisma } = await import('../src/config/database.js');
    prisma.businessRule.findUnique.mockResolvedValueOnce({ value: new Date().toISOString() });

    const { runAutoBackup } = await import('../src/services/backup.service.js');
    const result = await runAutoBackup();

    expect(result.skipped).toBe(true);
    expect(result.id).toBeUndefined();
  });

  it('merges local and cloud history correctly', async () => {
    const { mergeBackupLists } = await import('../src/services/backup.service.js');
    const local = [
      { id: 'a', createdAt: '2026-01-02T00:00:00.000Z', uploaded: false, source: 'local' },
      { id: 'b', createdAt: '2026-01-01T00:00:00.000Z', uploaded: false, source: 'local' },
    ];
    const cloud = [
      { id: 'b', createdAt: '2026-01-01T00:00:00.000Z', uploaded: true, source: 'cloud' },
      { id: 'c', createdAt: '2026-01-03T00:00:00.000Z', uploaded: true, source: 'cloud' },
    ];
    const merged = mergeBackupLists(local as never, cloud as never);
    expect(merged.map((m) => m.id)).toEqual(['c', 'a', 'b']);
    expect(merged.find((m) => m.id === 'b')?.source).toBe('both');
    expect(merged.find((m) => m.id === 'c')?.source).toBe('cloud');
    expect(merged.find((m) => m.id === 'a')?.source).toBe('local');
  });

  it('bucket ensure is a safe no-op without storage (never throws)', async () => {
    const { ensureBackupBucket } = await import('../src/services/backup.service.js');
    const { ensureAiReportsBucket } = await import('../src/services/aiReport.service.js');
    await expect(ensureBackupBucket()).resolves.toBeUndefined();
    await expect(ensureAiReportsBucket()).resolves.toBeUndefined();
  });
});
