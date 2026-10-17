import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, Upload, Download, Loader2, Trash2, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { recordsService } from '../../services/records';
import { useToast } from '../Toast';
import CollapsibleCard from './CollapsibleCard';

// Import past rental records (paper logbooks, pre-system walk-ins) so the
// demand forecast has real history to learn from. Analytical-only: imported
// rows NEVER become rentals — no availability, revenue, or reminders touch
// them. Shared by Staff Settings and the Admin Data & Backups tab.
const TEMPLATE_CSV =
  'name,category,address,event_date,price\n' +
  'Maria Santos,Gown,Balayan Batangas,2024-12-15,2500\n' +
  ',Barong,Calatagan Batangas,2024-12-20,1200\n';

const PAGE_SIZE = 10;

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default function HistoryImportPanel() {
  const { success: toastSuccess, error: toastError } = useToast();
  const fileRef = useRef(null);
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [rowErrors, setRowErrors] = useState([]);
  const [deletingId, setDeletingId] = useState(null);

  const load = async (pageNum = page) => {
    try {
      const [s, list] = await Promise.all([
        recordsService.stats().catch(() => null),
        recordsService.list({ limit: PAGE_SIZE, offset: pageNum * PAGE_SIZE }).catch(() => null),
      ]);
      if (s) setStats(s);
      if (list) {
        setRows(list.rows ?? []);
        setTotal(list.total ?? 0);
      }
    } catch {
      // Demo/offline with no route yet — panel renders its empty state.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(0); }, []);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rentech-history-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      toastError('Only .csv and .xlsx files can be imported');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toastError('File exceeds the 2MB limit');
      return;
    }
    setImporting(true);
    setResult(null);
    setRowErrors([]);
    try {
      const data = await fileToBase64(file);
      const res = await recordsService.importFile({ fileName: file.name, data });
      setResult(res);
      if (res.imported > 0) {
        toastSuccess(
          `Imported ${res.imported} new record${res.imported === 1 ? '' : 's'}` +
          (res.skippedDuplicates > 0 ? ` · ${res.skippedDuplicates} already-imported skipped` : '') +
          ' — forecast updated'
        );
      } else {
        toastSuccess(`Nothing new — all ${res.skippedDuplicates} row${res.skippedDuplicates === 1 ? ' was' : 's were'} already imported`);
      }
      setPage(0);
      await load(0);
    } catch (err) {
      // Row-level errors come back on `errors` in every env (the server
      // answers validation failures directly); `details.errors` is the dev
      // fallback. Either way nothing is saved until the file is clean.
      const errors = err?.body?.errors ?? err?.body?.details?.errors ?? err?.details?.errors ?? [];
      if (errors.length > 0) {
        setRowErrors(errors);
        toastError(`${errors.length} row(s) need fixing — nothing was imported`);
      } else {
        toastError(err?.message || 'Import failed');
      }
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await recordsService.remove(id);
      toastSuccess('Record removed — forecast updated');
      const nextPage = rows.length === 1 && page > 0 ? page - 1 : page;
      setPage(nextPage);
      await load(nextPage);
    } catch (err) {
      toastError(err?.message || 'Could not remove the record');
    } finally {
      setDeletingId(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <CollapsibleCard
      icon={FileSpreadsheet}
      iconClass="bg-violet-50 text-violet-600"
      title="Past Records Import"
      subtitle="Logbook history for the demand forecast — never creates rentals"
      storageKey="settings-history-import-open"
      badge={stats?.total ? `${stats.total} record${stats.total === 1 ? '' : 's'}` : null}
    >
      <div className="p-4 sm:p-5 space-y-4">
        <p className="text-xs text-gray-500 leading-relaxed">
          Upload past rentals from the paper logbook (<span className="font-bold">name</span> optional;{' '}
          <span className="font-bold">category</span>, <span className="font-bold">address</span>,{' '}
          <span className="font-bold">event date</span>, <span className="font-bold">price</span> required).
          They lengthen the forecast history and sharpen the per-category split — and nothing else uses them.
          Re-importing the same file is safe: exact duplicates are detected and skipped, never doubled.
        </p>

        {stats?.total > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded-xl px-2 py-2.5">
              <p className="text-lg font-extrabold text-gray-900">{stats.total}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Records</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-2 py-2.5">
              <p className="text-[11px] font-extrabold text-gray-900 leading-5">
                {stats.oldest ? fmtDate(stats.oldest) : '—'}<br />
                <span className="text-gray-400 font-bold">to</span> {stats.newest ? fmtDate(stats.newest) : '—'}
              </p>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Coverage</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-2 py-2.5">
              <p className="text-lg font-extrabold text-gray-900">{stats.categories?.length ?? 0}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Categories</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
          >
            <Download size={14} /> Template
          </button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" onChange={handleFile} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-white bg-[#bf4a53] hover:bg-red-700 rounded-xl transition-colors disabled:opacity-60"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing ? 'Importing…' : 'Import .csv / .xlsx'}
          </button>
        </div>

        {result && (
          <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200/70 rounded-xl px-3 py-2.5 text-xs text-emerald-800">
            <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
            <span>
              {result.imported > 0 ? (
                <>Imported <span className="font-extrabold">{result.imported}</span> new record{result.imported === 1 ? '' : 's'}
                {result.categories?.length > 0 && <> in {result.categories.join(', ')}</>}</>
              ) : (
                <>Nothing new — every row was already imported</>
              )}
              {result.skippedDuplicates > 0 && <> · <span className="font-extrabold">{result.skippedDuplicates}</span> duplicate{result.skippedDuplicates === 1 ? '' : 's'} skipped</>}.
              {result.imported > 0 && ' The forecast already includes them.'}
            </span>
          </div>
        )}

        {rowErrors.length > 0 && (
          <div className="bg-red-50 border border-red-200/70 rounded-xl px-3 py-2.5 text-xs text-red-800 space-y-1">
            <p className="flex items-center gap-1.5 font-bold">
              <AlertTriangle size={14} /> Fix these rows and import again — nothing was saved:
            </p>
            <ul className="list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto">
              {rowErrors.map((e, i) => (
                <li key={i}>Row {e.row}: {e.message}</li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-gray-400">Loading records…</p>
        ) : rows.length > 0 ? (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-xl border border-gray-100">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-50 last:border-0 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 truncate">{r.customerName || '—'} · {r.category}</p>
                    <p className="text-gray-400 truncate">{r.address} · {fmtDate(r.eventDate)} · ₱{Number(r.price).toLocaleString('en-PH')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    disabled={deletingId === r.id}
                    aria-label="Remove record"
                    className="p-1.5 text-gray-300 hover:text-[#bf4a53] transition-colors disabled:opacity-50 shrink-0"
                  >
                    {deletingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-500">
                <button
                  type="button"
                  onClick={() => { const p = Math.max(0, page - 1); setPage(p); load(p); }}
                  disabled={page === 0}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100 disabled:opacity-40"
                >
                  <ChevronLeft size={14} /> Newer
                </button>
                <span>Page {page + 1} of {pageCount}</span>
                <button
                  type="button"
                  onClick={() => { const p = Math.min(pageCount - 1, page + 1); setPage(p); load(p); }}
                  disabled={page >= pageCount - 1}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100 disabled:opacity-40"
                >
                  Older <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400">No imported records yet — download the template and import the logbook.</p>
        )}
      </div>
    </CollapsibleCard>
  );
}
