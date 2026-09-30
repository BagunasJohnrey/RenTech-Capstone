import { useState, useEffect, useCallback, useRef } from 'react';
import { Database, Download, RefreshCw, Loader2, FileText, Eye, Upload, X, AlertTriangle, CheckCircle2, CloudUpload, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { settingsService } from '../../services/settings';
import { aiService } from '../../services/ai';
import SettingsCard from './SettingsCard';
import AIReportModal from '../AIReportModal';

const fmtBytes = (n) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

// Admin Data & Backups tab: one-click JSON backup download + visible history
// of last backups, plus the last saved AI business reports (reopenable).
export default function DataBackupsTab() {
  const [backups, setBackups] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [backupsPage, setBackupsPage] = useState(0);
  const BACKUPS_PAGE_SIZE = 5;
  const [backingUp, setBackingUp] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupErr, setBackupErr] = useState('');

  // Import / restore state: file preview → confirm → result summary.
  const fileInputRef = useRef(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importStage, setImportStage] = useState(0);

  // Staged status lines while the server works (one response at the end, so
  // these narrate rather than measure — the bar eases toward 95% until done).
  const IMPORT_STAGES = [
    'Validating backup file…',
    'Restoring settings & templates…',
    'Restoring profiles…',
    'Restoring promos & inventory…',
    'Restoring transactions…',
    'Restoring payments & history…',
    'Finalizing…',
  ];
  useEffect(() => {
    if (!importing) return;
    setImportStage(0);
    const t = setInterval(() => {
      setImportStage((s) => Math.min(s + 1, IMPORT_STAGES.length - 1));
    }, 9000);
    return () => clearInterval(t);
  }, [importing]);

  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsPage, setReportsPage] = useState(0);
  const REPORTS_PAGE_SIZE = 5;
  // Deleting the last row of the last page must not strand a blank page.
  const safeReportsPage = Math.min(reportsPage, Math.max(0, Math.ceil(reports.length / REPORTS_PAGE_SIZE) - 1));
  const [uploadingReportId, setUploadingReportId] = useState(null);
  const [deletingReportId, setDeletingReportId] = useState(null);
  const [openReport, setOpenReport] = useState(null);
  const [openingId, setOpeningId] = useState(null);

  const loadBackups = useCallback(async () => {
    setBackupsLoading(true);
    setBackupErr('');
    try {
      const data = await settingsService.listBackups();
      setBackups(Array.isArray(data) ? data : []);
      setBackupsPage(0);
    } catch (err) {
      setBackupErr(err?.message || 'Could not load backups.');
      setBackups([]);
    } finally {
      setBackupsLoading(false);
    }
  }, []);

  const loadReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const data = await aiService.listReports();
      setReports(Array.isArray(data) ? data : []);
      setReportsPage(0);
    } catch {
      setReports([]);
    } finally {
      setReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBackups();
    loadReports();
  }, [loadBackups, loadReports]);

  const handleBackupNow = async () => {
    if (backingUp) return;
    setBackingUp(true);
    setBackupMsg('');
    setBackupErr('');
    try {
      const meta = await settingsService.createBackup();
      const cloudNote = meta?.uploaded ? 'Saved to cloud.' : 'Kept on this server only (cloud upload failed).';
      setBackupMsg(`Backup saved (${meta?.totalRows ?? 0} rows, ${meta?.storageFiles ?? 0} images, ${fmtBytes(meta?.sizeBytes)}). ${cloudNote} Downloading…`);
      setBackups((prev) => [meta, ...prev].slice(0, 20));
      setBackupsPage(0);
      try {
        await settingsService.downloadBackup(meta.id, meta.filename || `${meta.id}.json`);
      } catch (dlErr) {
        setBackupErr(dlErr?.message || 'Backup saved but download failed — retry from the list below.');
      }
    } catch (err) {
      setBackupErr(err?.message || 'Backup failed. Please try again.');
    } finally {
      setBackingUp(false);
      setTimeout(() => { setBackupMsg(''); }, 4000);
    }
  };

  const handleDownload = async (b) => {
    if (downloadingId) return;
    setDownloadingId(b.id);
    try {
      await settingsService.downloadBackup(b.id, b.filename || `${b.id}.json`);
    } catch (err) {
      setBackupErr(err?.message || 'Download failed. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleRetryUpload = async (b) => {
    if (uploadingId) return;
    setUploadingId(b.id);
    setBackupErr('');
    try {
      const updated = await settingsService.retryBackupUpload(b.id);
      setBackups((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...updated } : x)));
      setBackupMsg('Cloud copy saved.');
      setTimeout(() => setBackupMsg(''), 4000);
    } catch (err) {
      setBackupErr(err?.message || 'Cloud upload failed — check the server logs and try again.');
    } finally {
      setUploadingId(null);
    }
  };

  const handleOpenReport = async (r) => {
    if (openingId) return;
    setOpeningId(r.id);
    try {
      const full = await aiService.getReport(r.id);
      setOpenReport(full?.report || '');
    } catch {
      setOpenReport(r.excerpt || 'Could not load this report.');
    } finally {
      setOpeningId(null);
    }
  };

  const handleRetryReportUpload = async (r) => {
    if (uploadingReportId) return;
    setUploadingReportId(r.id);
    try {
      const updated = await aiService.retryReportUpload(r.id);
      setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...updated } : x)));
    } catch {
      // Error surfaces via the shared backup error line below.
      setBackupErr('Cloud upload failed — check the server logs and try again.');
    } finally {
      setUploadingReportId(null);
    }
  };

  const handleDeleteReport = async (r) => {
    if (deletingReportId) return;
    if (!window.confirm(`Delete this saved report (${fmtDate(r.createdAt)})? This cannot be undone.`)) return;
    setDeletingReportId(r.id);
    try {
      await aiService.deleteReport(r.id);
      setReports((prev) => prev.filter((x) => x.id !== r.id));
    } catch {
      setBackupErr('Delete failed — check the server logs and try again.');
    } finally {
      setDeletingReportId(null);
    }
  };

  // Import / restore: pick a previously downloaded backup JSON, preview its
  // contents, then confirm. The server upserts rows in FK order and reports
  // per-table restored/skipped counts.
  const handlePickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupErr('');
    setImportResult(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== 'object' || !payload.tables || typeof payload.tables !== 'object') {
        throw new Error('Not a RenTech backup file (missing "tables").');
      }
      const counts = {};
      for (const [k, v] of Object.entries(payload.tables)) {
        if (Array.isArray(v)) counts[k] = v.length;
      }
      if (Object.keys(counts).length === 0) throw new Error('Backup file has no table data.');
      setImportPreview({
        filename: file.name,
        id: payload.id || 'unknown',
        createdAt: payload.createdAt || null,
        counts,
        storageFiles: payload.storage?.fileCount ?? 0,
        payload,
      });
    } catch (err) {
      setImportPreview(null);
      setBackupErr(err?.message || 'Could not read that file.');
    }
  };

  const handleImport = async () => {
    if (!importPreview || importing) return;
    setImporting(true);
    setBackupErr('');
    try {
      const summary = await settingsService.importBackup(importPreview.payload);
      setImportResult({ filename: importPreview.filename, ...summary });
      setImportPreview(null);
      setBackupMsg('Restore complete — see the summary below.');
      setTimeout(() => setBackupMsg(''), 4000);
    } catch (err) {
      setBackupErr(err?.message || 'Restore failed. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <SettingsCard
        icon={Database}
        iconClass="bg-sky-50 text-sky-600"
        title="Data Backups"
        desc="One-click JSON download of all boutique data + history of recent backups"
        action={
          <div className="hidden sm:flex flex-wrap items-center justify-end gap-2 shrink-0 max-w-full">
            <button
              onClick={loadBackups}
              disabled={backupsLoading || backingUp}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50"
              title="Refresh list"
            >
              <RefreshCw size={15} className={backupsLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleBackupNow}
              disabled={backingUp}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {backingUp ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {backingUp ? 'Backing up…' : 'Backup now'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={backingUp || importing}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
              title="Restore from a previously downloaded backup file"
            >
              <Upload size={13} />
              Import
            </button>
            <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handlePickFile} />
          </div>
        }
      >
        <p className="text-sm text-gray-500 leading-relaxed">
          One JSON download of all boutique data, plus an image manifest so restores can verify nothing is missing.
          Copies save to private cloud automatically, with a daily auto-backup — file lists only, photo bytes stay in Supabase.
        </p>
        {backupMsg && <p className="text-xs text-emerald-600 font-bold">{backupMsg}</p>}
        {backupErr && <p className="text-xs text-red-500 font-bold">{backupErr}</p>}

        {/* Mobile actions — full-width stack (desktop uses the header row) */}
        <div className="sm:hidden space-y-2">
          <button
            onClick={handleBackupNow}
            disabled={backingUp}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-xl bg-gray-900 text-white hover:bg-gray-700 active:scale-[0.99] transition-all disabled:opacity-50"
          >
            {backingUp ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {backingUp ? 'Backing up…' : 'Backup now'}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={backingUp || importing}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.99] transition-all disabled:opacity-50"
              title="Restore from a previously downloaded backup file"
            >
              <Upload size={13} />
              Import
            </button>
            <button
              onClick={loadBackups}
              disabled={backupsLoading || backingUp}
              aria-label="Refresh list"
              className="p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-xl transition-colors disabled:opacity-50"
              title="Refresh list"
            >
              <RefreshCw size={15} className={backupsLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handlePickFile} />
        </div>

        {backupsLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
            <Loader2 size={15} className="animate-spin" /> Loading backups…
          </div>
        ) : backups.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No backups yet — click “Backup now” to create the first one.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Last backups ({backups.length})</p>
            {backups.slice(backupsPage * BACKUPS_PAGE_SIZE, backupsPage * BACKUPS_PAGE_SIZE + BACKUPS_PAGE_SIZE).map((b) => (
              <div key={b.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-2xl bg-gray-50/70 border border-gray-100">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-gray-900 truncate">{fmtDate(b.createdAt)}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {b.totalRows} rows · {b.storageFiles ?? 0} images · {fmtBytes(b.sizeBytes)}
                    {b.storageIncomplete && <span className="text-amber-600"> · storage partial</span>}
                    {b.source === 'cloud'
                      ? <span className="text-sky-600"> · cloud only</span>
                      : b.uploaded
                        ? <span className="text-emerald-600"> · cloud ✓</span>
                        : <span className="text-gray-400"> · server only</span>}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:flex items-center gap-2 sm:shrink-0">
                  {b.source === 'local' && !b.uploaded && (
                    <button
                      onClick={() => handleRetryUpload(b)}
                      disabled={uploadingId === b.id}
                      className="flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 sm:py-1.5 rounded-xl sm:rounded-full bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
                      title="Push this backup to cloud storage"
                    >
                      {uploadingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
                      {uploadingId === b.id ? 'Uploading…' : 'To cloud'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDownload(b)}
                    disabled={downloadingId === b.id}
                    className={`flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 sm:py-1.5 rounded-xl sm:rounded-full bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50 ${b.source === 'local' && !b.uploaded ? '' : 'col-span-2 sm:col-span-1'}`}
                  >
                    {downloadingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    {downloadingId === b.id ? 'Saving…' : 'Download'}
                  </button>
                </div>
              </div>
            ))}
            {backups.length > BACKUPS_PAGE_SIZE && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-gray-400 font-semibold tabular-nums">
                  Page {backupsPage + 1} of {Math.ceil(backups.length / BACKUPS_PAGE_SIZE)}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setBackupsPage(p => Math.max(0, p - 1))} disabled={backupsPage === 0}
                    aria-label="Previous backups page"
                    className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
                    <ChevronLeft size={15} />
                  </button>
                  <button onClick={() => setBackupsPage(p => Math.min(Math.ceil(backups.length / BACKUPS_PAGE_SIZE) - 1, p + 1))}
                    disabled={backupsPage >= Math.ceil(backups.length / BACKUPS_PAGE_SIZE) - 1}
                    aria-label="Next backups page"
                    className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Import preview → confirm */}
        {importPreview && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-sm text-gray-900 truncate">{importPreview.filename}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {importPreview.createdAt ? fmtDate(importPreview.createdAt) : 'Unknown date'}
                  {` · ${importPreview.storageFiles} images in manifest`}
                </p>
              </div>
              <button onClick={() => setImportPreview(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white rounded-full transition-colors" title="Cancel import">
                <X size={15} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(importPreview.counts).map(([t, n]) => (
                <span key={t} className="px-2 py-1 bg-white border border-amber-100 rounded-lg text-[11px] font-medium text-gray-600">
                  {t}: {n}
                </span>
              ))}
            </div>
            <p className="text-xs text-amber-700 leading-relaxed flex items-start gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              Restoring overwrites matching rows with the file's data. Rows whose customer/item is missing are skipped, never force-inserted. Your own admin role can never be demoted by a restore.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleImport}
                disabled={importing}
                className="flex items-center gap-1.5 px-5 py-2 bg-gray-900 text-white rounded-full text-sm font-bold hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {importing ? 'Restoring…' : 'Restore now'}
              </button>
              <button
                onClick={() => setImportPreview(null)}
                disabled={importing}
                className="px-5 py-2 border border-gray-200 bg-white rounded-full text-sm font-bold hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {importing && (
              <div className="rounded-2xl bg-white border border-gray-100 p-4 space-y-2.5" aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5 min-w-0">
                    <Loader2 size={13} className="animate-spin shrink-0 text-gray-500" />
                    <span className="truncate">{IMPORT_STAGES[importStage]}</span>
                  </p>
                  <span className="text-[11px] font-bold text-gray-400 tabular-nums shrink-0">
                    {Math.round(((importStage + 1) / IMPORT_STAGES.length) * 95)}%
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gray-900 transition-all duration-1000 ease-out"
                    style={{ width: `${((importStage + 1) / IMPORT_STAGES.length) * 95}%` }}
                  />
                </div>
                <p className="text-[11px] text-gray-400">Large backups can take up to 2 minutes — keep this tab open.</p>
              </div>
            )}
          </div>
        )}

        {/* Import result summary */}
        {importResult && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-emerald-600" />
                Restore complete
              </p>
              <button onClick={() => setImportResult(null)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white rounded-full transition-colors" title="Dismiss">
                <X size={15} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(importResult.restored || {}).map(([t, n]) => (
                <span key={t} className="px-2 py-1 bg-white border border-emerald-100 rounded-lg text-[11px] font-medium text-gray-600">
                  {t}: +{n}
                </span>
              ))}
              {Object.entries(importResult.skipped || {}).map(([t, n]) => (
                <span key={t} className="px-2 py-1 bg-amber-50 border border-amber-200 rounded-lg text-[11px] font-medium text-amber-700">
                  {t}: {n} skipped
                </span>
              ))}
              {Object.keys(importResult.restored || {}).length === 0 && Object.keys(importResult.skipped || {}).length === 0 && (
                <span className="text-xs text-gray-500">Nothing to restore.</span>
              )}
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        icon={FileText}
        iconClass="bg-purple-50 text-purple-600"
        title="Saved AI Reports"
        desc="Past business reports — reopen any recent one. Cloud-saved automatically."
        action={
          <button
            onClick={loadReports}
            disabled={reportsLoading}
            className="shrink-0 p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw size={15} className={reportsLoading ? 'animate-spin' : ''} />
          </button>
        }
      >
        {reportsLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
            <Loader2 size={15} className="animate-spin" /> Loading reports…
          </div>
        ) : reports.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No saved reports yet — generate one from Business Intelligence.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Last saved reports ({reports.length})</p>
            {reports.slice(safeReportsPage * REPORTS_PAGE_SIZE, safeReportsPage * REPORTS_PAGE_SIZE + REPORTS_PAGE_SIZE).map((r) => (
              <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-2xl bg-gray-50/70 border border-gray-100">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-gray-900">
                    {fmtDate(r.createdAt)}
                    {r.origin === 'cloud'
                      ? <span className="font-medium text-sky-600"> · cloud only</span>
                      : r.uploaded
                        ? <span className="font-medium text-emerald-600"> · cloud ✓</span>
                        : <span className="font-medium text-gray-400"> · server only</span>}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{r.excerpt || 'Business performance report'}</p>
                  {(r.provider || r.model) && (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {[r.provider, r.model].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto] sm:flex items-center gap-2 sm:shrink-0">
                  {r.origin === 'local' && !r.uploaded && (
                    <button
                      onClick={() => handleRetryReportUpload(r)}
                      disabled={uploadingReportId === r.id}
                      className="flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 sm:py-1.5 rounded-xl sm:rounded-full bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
                      title="Push this report to cloud storage"
                    >
                      {uploadingReportId === r.id ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
                      {uploadingReportId === r.id ? 'Uploading…' : 'To cloud'}
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenReport(r)}
                    disabled={openingId === r.id}
                    className="flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 sm:py-1.5 rounded-xl sm:rounded-full bg-white border border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    {openingId === r.id ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                    {openingId === r.id ? 'Opening…' : 'View'}
                  </button>
                  <button
                    onClick={() => handleDeleteReport(r)}
                    disabled={deletingReportId === r.id}
                    title="Delete this saved report"
                    aria-label={`Delete report from ${fmtDate(r.createdAt)}`}
                    className="flex items-center justify-center p-2 rounded-xl sm:rounded-full bg-white border border-gray-200 text-gray-300 hover:text-red-600 hover:bg-red-50 hover:border-red-100 transition-colors disabled:opacity-50"
                  >
                    {deletingReportId === r.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            ))}
            {reports.length > REPORTS_PAGE_SIZE && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-gray-400 font-semibold tabular-nums">
                  Page {safeReportsPage + 1} of {Math.ceil(reports.length / REPORTS_PAGE_SIZE)}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setReportsPage(p => Math.max(0, p - 1))} disabled={safeReportsPage === 0}
                    aria-label="Previous reports page"
                    className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
                    <ChevronLeft size={15} />
                  </button>
                  <button onClick={() => setReportsPage(p => Math.min(Math.ceil(reports.length / REPORTS_PAGE_SIZE) - 1, p + 1))}
                    disabled={safeReportsPage >= Math.ceil(reports.length / REPORTS_PAGE_SIZE) - 1}
                    aria-label="Next reports page"
                    className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </SettingsCard>

      {openReport !== null && (
        <AIReportModal geminiReport={openReport} onClose={() => setOpenReport(null)} />
      )}
    </>
  );
}
