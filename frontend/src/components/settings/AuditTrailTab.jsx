import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, History, Search, RotateCcw, X, Bot, Loader2 } from 'lucide-react';
import { api } from '../../utils/api';
import { useToast } from '../Toast';
import CollapsibleCard from './CollapsibleCard';
import Pagination from '../ui/Pagination';
import BottomSheet from '../BottomSheet';

// Admin → Settings → Audit Trail: who did what, when, with before/after.
// Reads /api/audit (Admin + MFA). Filters are server-side so the export
// matches what's on screen.

const PAGE_SIZE = 25;

const ACTION_LABELS = {
  'settings.rules.update': 'Changed business settings',
  'settings.sms-template.create': 'Added SMS template',
  'settings.sms-template.update': 'Edited SMS template',
  'settings.sms-template.delete': 'Deleted SMS template',
  'settings.promo-code.create': 'Added voucher',
  'settings.promo-code.update': 'Edited voucher',
  'settings.promo-code.delete': 'Deleted voucher',
  'staff.create': 'Added staff account',
  'staff.update': 'Edited staff account',
  'staff.remove': 'Removed staff account',
  'sms.send': 'Sent SMS',
  'sms.resend': 'Resent SMS',
  'sms.delete': 'Deleted SMS log entry',
  'payment_proof.submit': 'Payment proof submitted',
  'payment_proof.approve': 'Payment proof approved',
  'payment_proof.reject': 'Payment proof rejected',
  'inventory.price.update': 'Changed item price',
  'inventory.sale.update': 'Changed item sale',
  item_swap: 'Swapped rental item',
  'export.download': 'Downloaded export',
  'backup.create': 'Created backup',
  'backup.auto': 'Automatic backup',
  'backup.download': 'Downloaded backup',
  'backup.upload': 'Uploaded backup',
  'backup.import': 'Restored backup',
  'records.import': 'Imported past records',
  'records.delete': 'Deleted past record',
  'report.auto': 'Automatic AI report',
  'promo_ideas.auto': 'Automatic promo ideas',
  'ai.reindex': 'Re-indexed AI knowledge',
  contact_admin: 'Customer message to admin',
};

const ENTITY_LABELS = {
  transaction: 'Rental',
  inventory: 'Item',
  payment: 'Payment',
  payment_proof: 'Payment proof',
  customer: 'Customer',
  staff: 'Staff',
  sms: 'SMS',
  'sms-template': 'SMS template',
  'promo-code': 'Voucher',
  settings: 'Settings',
  business_rule: 'Setting',
  backup: 'Backup',
  records: 'Past records',
  export: 'Export',
  ai_report: 'AI report',
  promo_suggestion: 'Promo idea',
  ai: 'AI',
};

const humanize = (s) => String(s || '').replace(/[._-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const entityLabel = (e) => ENTITY_LABELS[e] || humanize(e);
export function actionLabel(action, entity) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  if (action === 'create') return `Created ${entityLabel(entity).toLowerCase()}`;
  if (action === 'update') return `Updated ${entityLabel(entity).toLowerCase()}`;
  if (action === 'delete') return `Deleted ${entityLabel(entity).toLowerCase()}`;
  return humanize(action);
}

const fmtWhen = (d) => new Date(d).toLocaleString('en-PH', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
});

const EMPTY_FILTERS = { from: '', to: '', actorId: '', action: '', entity: '', q: '' };

function toQuery(filters, extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...filters, ...extra }).forEach(([k, v]) => { if (v !== '' && v != null) params.set(k, String(v)); });
  const s = params.toString();
  return s ? `?${s}` : '';
}

const fmtValue = (v) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

// Field-by-field before → after when both sides are plain objects; otherwise
// the raw values are shown as-is.
function changedFields(oldValue, newValue) {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(oldValue) && !isObj(newValue)) return null;
  const a = isObj(oldValue) ? oldValue : {};
  const b = isObj(newValue) ? newValue : {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ key: k, before: a[k], after: b[k] }));
}

function ActorCell({ actor }) {
  if (!actor) {
    return (
      <span className="inline-flex items-center gap-1.5 text-gray-500">
        <Bot size={14} aria-hidden="true" /> System
      </span>
    );
  }
  return (
    <span className="min-w-0">
      <span className="block font-semibold text-gray-900 truncate">{actor.name}</span>
      {actor.role && <span className="block text-[11px] text-gray-400">{actor.role}</span>}
    </span>
  );
}

function AuditDetailSheet({ row, onClose }) {
  const fields = changedFields(row.oldValue, row.newValue);
  return (
    <BottomSheet onClose={onClose} labelledby="dialog-title-audit-detail" maxWidth="sm:max-w-lg">
      <div className="shrink-0 flex items-start justify-between gap-3 px-5 pt-3 pb-3 border-b border-gray-100">
        <div className="min-w-0">
          <h3 id="dialog-title-audit-detail" className="font-bold text-gray-900">{actionLabel(row.action, row.entity)}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{fmtWhen(row.createdAt)}</p>
        </div>
        <button onClick={onClose} aria-label="Close details" className="p-2 text-gray-400 hover:bg-gray-100 rounded-full shrink-0">
          <X size={18} />
        </button>
      </div>
      <div data-sheet-scroll className="overflow-y-auto min-h-0 p-5 space-y-4 text-sm">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
          <dt className="text-gray-500">Performed by</dt>
          <dd><ActorCell actor={row.actor} /></dd>
          <dt className="text-gray-500">Target</dt>
          <dd className="text-gray-900">{entityLabel(row.entity)}</dd>
          <dt className="text-gray-500">Target ID</dt>
          <dd className="font-mono text-xs text-gray-700 break-all">{row.entityId}</dd>
          <dt className="text-gray-500">Action code</dt>
          <dd className="font-mono text-xs text-gray-700 break-all">{row.action}</dd>
        </dl>

        {fields && fields.length > 0 ? (
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Changes</p>
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {fields.map((f) => (
                <div key={f.key} className="px-3 py-2.5">
                  <p className="text-xs font-semibold text-gray-700 mb-1">{humanize(f.key)}</p>
                  <p className="text-xs break-all">
                    <span className="text-red-600 line-through decoration-red-300">{fmtValue(f.before)}</span>
                    <span className="text-gray-400 mx-1.5">→</span>
                    <span className="text-emerald-700 font-semibold">{fmtValue(f.after)}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (row.oldValue != null || row.newValue != null) ? (
          <div className="space-y-3">
            {row.oldValue != null && (
              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Before</p>
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 whitespace-pre-wrap break-all">{JSON.stringify(row.oldValue, null, 2)}</pre>
              </div>
            )}
            {row.newValue != null && (
              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">After</p>
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 whitespace-pre-wrap break-all">{JSON.stringify(row.newValue, null, 2)}</pre>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400">No extra details were recorded for this event.</p>
        )}
      </div>
    </BottomSheet>
  );
}

export default function AuditTrailTab() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState(''); // debounced into filters.q
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [facets, setFacets] = useState({ actions: [], entities: [], actors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const { error: toastError } = useToast();

  useEffect(() => {
    api.get('/audit/facets').then((f) => f && setFacets(f)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.get(`/audit${toQuery(filters, { page, pageSize: PAGE_SIZE })}`)
      .then((d) => { if (active) setData(d || { rows: [], total: 0 }); })
      .catch((e) => { if (active) setError(e?.message || 'Could not load the audit trail'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, page]);
  useEffect(() => load(), [load]);

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const hasFilters = useMemo(() => Object.values(filters).some((v) => v !== '') || search !== '', [filters, search]);
  const reset = () => { setFilters(EMPTY_FILTERS); setSearch(''); setPage(1); };
  const dateError = filters.from && filters.to && filters.from > filters.to ? '"From" must be on or before "To"' : '';

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));

  const handleExport = async () => {
    if (dateError) return;
    setExporting(true);
    try {
      await api.download(`/audit/export${toQuery(filters)}`, `rentech-audit-trail-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      toastError(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const selectClass = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15';
  const labelClass = 'block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1';

  return (
    <CollapsibleCard
      icon={History}
      iconClass="bg-violet-50 text-violet-600"
      title="Audit Trail"
      subtitle="Every recorded change and sensitive action, newest first. Tap a row for before/after details."
      storageKey="settings-audit-trail-open"
      headerAction={(
        <button onClick={handleExport} disabled={exporting || !!dateError}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-full bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors">
          {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          Excel
        </button>
      )}
    >
      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="col-span-2 md:col-span-3 lg:col-span-2">
          <label htmlFor="audit-search" className={labelClass}>Search</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input id="audit-search" type="search" value={search} maxLength={100}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Action or target ID"
              className={`${selectClass} pl-9`} />
          </div>
        </div>
        <div>
          <label htmlFor="audit-from" className={labelClass}>From</label>
          <input id="audit-from" type="date" value={filters.from} max={filters.to || undefined}
            onChange={(e) => setFilter('from', e.target.value)} className={selectClass} />
        </div>
        <div>
          <label htmlFor="audit-to" className={labelClass}>To</label>
          <input id="audit-to" type="date" value={filters.to} min={filters.from || undefined}
            onChange={(e) => setFilter('to', e.target.value)} className={selectClass} />
        </div>
        <div>
          <label htmlFor="audit-actor" className={labelClass}>Performed by</label>
          <select id="audit-actor" value={filters.actorId} onChange={(e) => setFilter('actorId', e.target.value)} className={selectClass}>
            <option value="">Everyone</option>
            <option value="system">System (automatic)</option>
            {facets.actors.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` (${a.role})` : ''}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="audit-action" className={labelClass}>Action</label>
          <select id="audit-action" value={filters.action} onChange={(e) => setFilter('action', e.target.value)} className={selectClass}>
            <option value="">All actions</option>
            {facets.actions.map((a) => <option key={a} value={a}>{actionLabel(a, '')}{ACTION_LABELS[a] ? '' : ` (${a})`}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-2">
          <label htmlFor="audit-entity" className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Target</label>
          <select id="audit-entity" value={filters.entity} onChange={(e) => setFilter('entity', e.target.value)}
            className="bg-white border border-gray-200 rounded-full px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:border-[#bf4a53]">
            <option value="">All</option>
            {facets.entities.map((e) => <option key={e} value={e}>{entityLabel(e)}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500" aria-live="polite">{loading ? 'Loading…' : `${data.total.toLocaleString()} event(s)`}</span>
          {hasFilters && (
            <button onClick={reset} className="inline-flex items-center gap-1 text-xs font-bold text-[#bf4a53] hover:underline">
              <RotateCcw size={12} /> Clear filters
            </button>
          )}
        </div>
      </div>
      {dateError && <p role="alert" className="text-xs text-red-500 font-medium mt-2">{dateError}</p>}

      {/* Results */}
      <div className="mt-4">
        {error ? (
          <div className="text-center py-10">
            <p className="text-sm text-red-500 font-medium">{error}</p>
            <button onClick={load} className="mt-2 text-xs font-bold text-[#bf4a53] hover:underline">Try again</button>
          </div>
        ) : loading && data.rows.length === 0 ? (
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}
          </div>
        ) : data.rows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">No audit events match these filters.</p>
        ) : (
          <>
            {/* Desktop table */}
            <div className={`hidden md:block overflow-hidden rounded-xl border border-gray-200 ${loading ? 'opacity-60' : ''}`}>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2.5 w-44">When</th>
                    <th className="text-left px-4 py-2.5 w-48">Performed by</th>
                    <th className="text-left px-4 py-2.5">Action</th>
                    <th className="text-left px-4 py-2.5 w-56">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.map((r) => (
                    <tr key={r.id} onClick={() => setSelected(r)} className="cursor-pointer hover:bg-red-50/40 transition-colors">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap tabular-nums">{fmtWhen(r.createdAt)}</td>
                      <td className="px-4 py-3"><ActorCell actor={r.actor} /></td>
                      <td className="px-4 py-3 font-medium text-gray-900">{actionLabel(r.action, r.entity)}</td>
                      <td className="px-4 py-3 min-w-0">
                        <span className="block text-gray-700">{entityLabel(r.entity)}</span>
                        <span className="block font-mono text-[11px] text-gray-400 truncate max-w-[13rem]" title={r.entityId}>{r.entityId}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className={`md:hidden space-y-2 ${loading ? 'opacity-60' : ''}`}>
              {data.rows.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelected(r)} className="w-full text-left rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-red-50/40 transition-colors">
                    <p className="font-semibold text-gray-900 text-sm">{actionLabel(r.action, r.entity)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{r.actor ? `${r.actor.name}${r.actor.role ? ` · ${r.actor.role}` : ''}` : 'System'} · {fmtWhen(r.createdAt)}</p>
                    <p className="text-[11px] text-gray-400 mt-1 truncate">{entityLabel(r.entity)} · <span className="font-mono">{r.entityId}</span></p>
                  </button>
                </li>
              ))}
            </ul>

            <Pagination className="mt-4" page={page} totalPages={totalPages} onPageChange={(p) => setPage(Math.min(Math.max(1, p), totalPages))} />
          </>
        )}
      </div>

      {selected && <AuditDetailSheet row={selected} onClose={() => setSelected(null)} />}
    </CollapsibleCard>
  );
}
