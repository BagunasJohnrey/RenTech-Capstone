import { useState, useCallback, useEffect, useMemo } from 'react';
import BottomSheet from '../components/BottomSheet';
import { Sparkles, Tag, Percent, Lightbulb, Loader2, AlertCircle, Clock, Trash2, Calendar, X, Check, Undo2, History, ChevronLeft, Pencil, PackageX, Ticket } from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';
import ItemImage from '../components/ItemImage';
import { getSaleInfo } from '../components/ItemCard';
import PromoCodesManager from '../components/PromoCodesManager';
import BulkSaleManager from '../components/BulkSaleManager';
import { IconButton } from '../components/ui/Button';
import Pagination from '../components/ui/Pagination';
import PageHeader from '../components/ui/PageHeader';
import { inventoryService } from '../services';
import { useConfirm } from '../hooks/useConfirm';

// ─── Caching ───────────────────────────────────────────────────────────
const CACHE_KEY = 'rentech_promo_suggestions';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const suggestCache = new Map();

// Returns { data, at, meta } — `meta` carries the label (date/provider) of
// what is showing, so a reload keeps "Generated Oct 27 · weekly" accurate.
function readCache() {
  const mem = suggestCache.get('current');
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) return mem;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.at < CACHE_TTL_MS) {
        suggestCache.set('current', parsed);
        return parsed;
      }
    }
  } catch {}
  return null;
}

function writeCache(data, meta = null) {
  const entry = { data, at: Date.now(), meta };
  suggestCache.set('current', entry);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch {}
}

// ─── Error formatting ──────────────────────────────────────────────────
function formatError(err) {
  if (err?.status === 403) return 'You don\'t have permission to do this.';
  if (err?.status === 404) return 'Not found — it may have been deleted.';
  if (err?.status === 429) return 'Too many requests — please wait a moment and try again.';
  if (err?.status === 503 || err?.status === 502) return 'Server is temporarily unavailable. Try again shortly.';
  if (err?.name === 'TimeoutError' || err?.message?.includes('too long')) return 'Request timed out — the server may be offline.';
  if (err?.message?.includes('network') || err?.message?.includes('fetch')) return 'Network error — check your connection.';
  return err?.message || 'Something went wrong. Please try again.';
}

// ─── Seasonal Calendar ─────────────────────────────────────────────────
const SEASONAL_EVENTS = {
  January: ['New Year promos', 'Sinulog Festival'],
  February: ["Valentine's Day", 'Love/wedding theme'],
  March: ['Summer prep', 'Holy Week'],
  April: ['Holy Week', 'Summer peak'],
  May: ['Graduation season', 'Debut season'],
  June: ['Rainy season starts', 'Corporate events'],
  July: ['Rainy season', 'Mid-year clearance'],
  August: ['National Heroes Day', 'Back-to-school'],
  September: ['BER months begin', 'Early holiday prep'],
  October: ['BER months', 'Halloween events'],
  November: ['Undas (All Saints)', 'Early Christmas'],
  December: ['Christmas parties', 'Year-end galas', 'Simbang Gabi'],
};

const PAGE_SIZE = 6;
const TABS = [
  { id: 'ideas', label: 'AI Ideas', icon: Sparkles },
  { id: 'sales', label: 'Item Sales', icon: Tag },
  { id: 'codes', label: 'Promo Codes', icon: Ticket },
];

const peso = (n) => `₱${Math.round(n).toLocaleString()}`;
const daysFromNow = (d) => (d ? new Date(Date.now() + d * 86400000).toISOString().split('T')[0] : null);
const suggestionKey = (s) => s.itemId || s.itemName;
// Label for a saved history row. `createdBy` is null only for scheduler runs.
const savedMeta = (full) => ({
  source: full.source || 'ai', provider: full.provider, model: full.model,
  createdAt: full.createdAt, auto: full.createdBy == null,
});
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

function StatTile({ icon: Icon, label, value, hint, tone, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="text-left bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 hover:border-gray-200 hover:shadow transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40">
      <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${tone}`}><Icon size={15} /></span>
      <p className="text-2xl font-bold text-gray-900 mt-3 leading-none tabular-nums">{value}</p>
      <p className="text-xs font-semibold text-gray-600 mt-1.5">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{hint}</p>}
    </button>
  );
}

export default function PromotionsView({ inventory, onEditItem, onSalePatch }) {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [tab, setTab] = useState('ideas');
  const [suggestions, setSuggestions] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [promoFormPrefill, setPromoFormPrefill] = useState(null);
  const [promoCodes, setPromoCodes] = useState([]);
  const [appliedItems, setAppliedItems] = useState(new Set());
  const [appliedVouchers, setAppliedVouchers] = useState(new Set());
  const [dismissedItems, setDismissedItems] = useState(new Set());
  const [applyingKey, setApplyingKey] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [salesFilter, setSalesFilter] = useState(null);

  // Saved suggestions history
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedList, setSavedList] = useState([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState('');
  const [savedPage, setSavedPage] = useState(1);
  const [viewingSaved, setViewingSaved] = useState(null);
  const [viewingSavedData, setViewingSavedData] = useState(null);
  const [viewingLoading, setViewingLoading] = useState(false);
  const [viewingError, setViewingError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' });
  const seasonalTips = SEASONAL_EVENTS[currentMonth] || [];

  // Show what we have right away (this browser's last run), then swap in the
  // newest saved run if it is newer — e.g. the Monday auto-run, or a run made
  // on another device. Without this the tab looked empty after 24h even
  // though history had ideas.
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setSuggestions(cached.data);
      if (cached.meta) setLastResult(cached.meta);
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await api.get('/ai/promo-suggestions');
        const latest = Array.isArray(list) ? list[0] : null;
        if (!latest || cancelled) return;
        // Re-read the cache at each step: a Generate click while this was
        // loading writes a newer entry, which must win over the saved run.
        const isStale = () => {
          const current = readCache();
          return current && Date.parse(latest.createdAt) <= current.at;
        };
        if (isStale()) return;
        const full = await api.get(`/ai/promo-suggestions/${latest.id}`);
        if (cancelled || !full?.suggestions || isStale()) return;
        const meta = savedMeta(full);
        setSuggestions(full.suggestions);
        setLastResult(meta);
        writeCache(full.suggestions, meta);
      } catch { /* history is optional — the Generate button still works */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const sellable = useMemo(() => (inventory || []).filter(i => i.status !== 'Deleted'), [inventory]);
  const findItem = useCallback((s) => sellable.find(i => i.id === s.itemId || i.name === s.itemName), [sellable]);

  const stats = useMemo(() => {
    const now = new Date();
    const liveSales = sellable.filter(i => getSaleInfo(i).active).length;
    const neverRented = sellable.filter(i => (i.rentalCount ?? 0) === 0).length;
    const usableCodes = promoCodes.filter(c =>
      c.isActive
      && !(c.expiresAt && new Date(c.expiresAt) < now)
      && !(c.startsAt && new Date(c.startsAt) > now)
      && !(c.maxUses !== null && c.currentUses >= c.maxUses)).length;
    return { liveSales, neverRented, usableCodes };
  }, [sellable, promoCodes]);

  const pendingItems = useMemo(
    () => (suggestions?.itemSuggestions || []).filter(s => !dismissedItems.has(suggestionKey(s))),
    [suggestions, dismissedItems],
  );
  const vouchers = suggestions?.voucherSuggestions || [];
  const unappliedItems = pendingItems.filter(s => !appliedItems.has(suggestionKey(s)) && findItem(s));
  const ideasWaiting = unappliedItems.length + vouchers.filter(v => !appliedVouchers.has(v.code)).length;

  // ─── Load saved suggestions ────────────────────────────────────────
  const loadSaved = useCallback(async () => {
    setSavedLoading(true);
    setSavedError('');
    try {
      const data = await api.get('/ai/promo-suggestions');
      setSavedList(Array.isArray(data) ? data : []);
    } catch (err) {
      setSavedError(formatError(err));
      setSavedList([]);
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  // ─── Fetch AI suggestions ─────────────────────────────────────────
  const fetchSuggestions = useCallback(async () => {
    setTab('ideas');
    setLoading(true);
    setError('');
    try {
      const result = await api.post('/ai/suggest-promos');
      const data = result.suggestions || { itemSuggestions: [], voucherSuggestions: [] };
      const meta = { source: result.source, provider: result.provider, model: result.model, createdAt: new Date().toISOString(), auto: false };
      setSuggestions(data);
      setLastResult(meta);
      setDismissedItems(new Set());
      setAppliedItems(new Set());
      setAppliedVouchers(new Set());
      setExpanded(new Set());
      writeCache(data, meta);
      loadSaved();
      const itemCount = data.itemSuggestions?.length || 0;
      const voucherCount = data.voucherSuggestions?.length || 0;
      if (result.source === 'error') {
        if (result.retryable) {
          toastError('AI providers are rate-limited — try again in a moment.');
        } else {
          setError('AI service is unavailable. Showing rule-based suggestions instead.');
          toastError('AI service is currently unavailable. Please try again later.');
        }
      } else if (itemCount || voucherCount) {
        // Identical suggestions to the latest saved entry → the server reused
        // it instead of stacking a duplicate history row.
        if (result.deduped) toastInfo('Suggestions unchanged — showing the existing entry.');
        else toastSuccess(`Generated ${itemCount} item sale${itemCount !== 1 ? 's' : ''} and ${voucherCount} voucher idea${voucherCount !== 1 ? 's' : ''}`);
      } else {
        toastSuccess('Analysis complete — no promotions needed right now');
      }
    } catch (err) {
      const msg = formatError(err);
      setError(msg);
      toastError(msg);
    } finally {
      setLoading(false);
    }
  }, [loadSaved, toastSuccess, toastError, toastInfo]);

  // ─── Apply item sales directly ────────────────────────────────────
  // Suggestions sharing the same discount + duration go out in one bulk-sale
  // call. (Opening the item editor per suggestion only ever showed the last
  // one, so "Apply All" used to apply a single item.)
  const applySales = useCallback(async (list) => {
    const groups = new Map();
    for (const s of list) {
      const item = findItem(s);
      if (!item) continue;
      const gk = `${s.discountPct}|${s.suggestedExpiryDays || ''}`;
      if (!groups.has(gk)) groups.set(gk, { s, ids: [], keys: [] });
      groups.get(gk).ids.push(item.id);
      groups.get(gk).keys.push(suggestionKey(s));
    }
    let applied = 0;
    for (const { s, ids, keys } of groups.values()) {
      const sale = { onSale: true, discountPct: s.discountPct, salePrice: null, saleEndsAt: daysFromNow(s.suggestedExpiryDays) };
      await inventoryService.bulkSale(ids, sale);
      onSalePatch?.(ids, sale);
      setAppliedItems(prev => new Set([...prev, ...keys]));
      applied += ids.length;
    }
    return applied;
  }, [findItem, onSalePatch]);

  const handleApplyOne = async (s) => {
    if (!findItem(s)) { toastError(`"${s.itemName}" not found in inventory — it may have been removed.`); return; }
    setApplyingKey(suggestionKey(s));
    try {
      await applySales([s]);
      toastSuccess(`${s.itemName} is now ${s.discountPct}% off`);
    } catch (err) {
      toastError(formatError(err));
    } finally {
      setApplyingKey(null);
    }
  };

  const handleApplyAll = async () => {
    if (!unappliedItems.length) return;
    const ok = await confirm({
      title: `Put ${unappliedItems.length} item${unappliedItems.length !== 1 ? 's' : ''} on sale?`,
      message: 'Each item gets the discount and end date suggested for it. You can adjust or clear them anytime under Item Sales.',
      confirmLabel: 'Apply all',
    });
    if (!ok) return;
    setApplyingKey('__all__');
    try {
      const n = await applySales(unappliedItems);
      toastSuccess(`${n} item sale${n !== 1 ? 's' : ''} applied`);
    } catch (err) {
      toastError(formatError(err));
    } finally {
      setApplyingKey(null);
    }
  };

  const handleEditFirst = (s) => {
    const item = findItem(s);
    if (!item || !onEditItem) return;
    onEditItem({ ...item, onSale: true, discountPct: s.discountPct, saleEndsAt: daysFromNow(s.suggestedExpiryDays) ?? undefined });
  };

  // ─── Create promo code ───────────────────────────────────────────
  const handleCreateCode = (s) => {
    setPromoFormPrefill({
      code: s.code,
      discountPct: s.discountPct,
      maxUses: String(s.maxUses || ''),
      expiresAt: daysFromNow(s.expiresInDays) || '',
    });
    setAppliedVouchers(prev => new Set([...prev, s.code]));
    setTab('codes');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toastInfo(`"${s.code}" is pre-filled — review and create it`);
  };

  // ─── Saved history ───────────────────────────────────────────────
  const viewSavedSuggestion = async (meta) => {
    setViewingSaved(meta);
    setViewingSavedData(null);
    setViewingError('');
    setViewingLoading(true);
    try {
      setViewingSavedData(await api.get(`/ai/promo-suggestions/${meta.id}`));
    } catch (err) {
      setViewingError(formatError(err));
    } finally {
      setViewingLoading(false);
    }
  };

  const deleteSavedSuggestion = async (id) => {
    const ok = await confirm({ title: 'Delete saved suggestion?', message: 'This removes it from your saved list. This cannot be undone.', variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    setDeletingId(id);
    try {
      await api.delete(`/ai/promo-suggestions/${id}`);
      setSavedList(prev => prev.filter(s => s.id !== id));
      if (viewingSaved?.id === id) setViewingSaved(null);
      toastSuccess('Suggestion deleted');
    } catch (err) {
      toastError(formatError(err));
    } finally {
      setDeletingId(null);
    }
  };

  const closeHistory = () => { setHistoryOpen(false); setViewingSaved(null); setViewingSavedData(null); setViewingError(''); };

  const loadSuggestionAsCurrent = (full) => {
    if (!full?.suggestions) return;
    const meta = savedMeta(full);
    setSuggestions(full.suggestions);
    setLastResult(meta);
    writeCache(full.suggestions, meta);
    setAppliedItems(new Set());
    setAppliedVouchers(new Set());
    setDismissedItems(new Set());
    setExpanded(new Set());
    closeHistory();
    setTab('ideas');
    toastSuccess('Loaded saved suggestion as current');
  };

  const toggleExpanded = (k) => setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // The history panel is full height on desktop, so a page holds twice as
  // many runs there (no empty band under a short list). Phones keep 6.
  const [wideScreen, setWideScreen] = useState(() => {
    try { return window.matchMedia('(min-width: 1024px)').matches; } catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia('(min-width: 1024px)'); } catch { return undefined; }
    const onChange = (e) => setWideScreen(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const historyPageSize = wideScreen ? PAGE_SIZE * 2 : PAGE_SIZE;
  const savedTotalPages = Math.max(1, Math.ceil(savedList.length / historyPageSize));
  const savedPaged = savedList.slice((Math.min(savedPage, savedTotalPages) - 1) * historyPageSize, Math.min(savedPage, savedTotalPages) * historyPageSize);
  const tabCounts = { ideas: ideasWaiting || null, sales: stats.liveSales || null, codes: stats.usableCodes || null };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl">
      {confirmDialog}
      <PageHeader
        title="Promotions"
        subtitle="Put slow pieces on sale, run promo codes, and get AI ideas for the season."
        actions={(
          <>
            <button type="button" onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-xs font-bold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors">
              <History size={14} /> History
              {savedList.length > 0 && <span className="text-[11px] text-gray-400 font-semibold">{savedList.length}</span>}
            </button>
            <button type="button" onClick={fetchSuggestions} disabled={loading}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-xs font-bold text-white bg-[#bf4a53] hover:bg-red-700 shadow-sm shadow-[#bf4a53]/20 transition-colors disabled:opacity-60">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loading ? 'Analyzing…' : suggestions ? 'New ideas' : 'Get AI ideas'}
            </button>
          </>
        )}
      />

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={Tag} tone="bg-rose-50 text-[#bf4a53]" label="Items on sale" value={stats.liveSales}
          hint={`of ${sellable.length} pieces`} onClick={() => { setSalesFilter('onSale'); setTab('sales'); }} />
        <StatTile icon={PackageX} tone="bg-amber-50 text-amber-600" label="Never rented" value={stats.neverRented}
          hint="Good sale candidates" onClick={() => { setSalesFilter('never'); setTab('sales'); }} />
        <StatTile icon={Ticket} tone="bg-emerald-50 text-emerald-600" label="Live promo codes" value={stats.usableCodes}
          hint={`${promoCodes.length} total`} onClick={() => setTab('codes')} />
        <StatTile icon={Sparkles} tone="bg-violet-50 text-violet-600" label="AI ideas waiting" value={ideasWaiting}
          hint={suggestions ? 'Not yet applied' : 'None generated yet'} onClick={() => setTab('ideas')} />
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Promotion sections" className="flex gap-1 p-1 bg-gray-100/80 rounded-2xl overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button key={id} role="tab" aria-selected={active} onClick={() => setTab(id)}
              className={`flex-1 min-w-max inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl text-xs font-bold transition-all ${
                active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}>
              <Icon size={14} className={active ? 'text-[#bf4a53]' : ''} />
              {label}
              {tabCounts[id] != null && (
                <span className={`min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full text-[11px] ${active ? 'bg-rose-50 text-[#bf4a53]' : 'bg-gray-200/70 text-gray-500'}`}>{tabCounts[id]}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── AI Ideas ─────────────────────────────────────────────── */}
      <section hidden={tab !== 'ideas'} className="space-y-5">
        {/* Context banner */}
        <div className="rounded-3xl bg-gradient-to-br from-[#bf4a53] to-red-600 text-white p-5 md:p-6 shadow-lg shadow-[#bf4a53]/15">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center shrink-0"><Sparkles size={18} /></span>
              <div className="min-w-0">
                <h3 className="font-bold text-base leading-tight">Promotion Advisor</h3>
                <p className="text-white/70 text-xs mt-1">Reads your inventory, rental history and the season, then proposes sales and codes. New ideas arrive automatically every Monday.</p>
                {seasonalTips.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold text-white/60 uppercase tracking-wider flex items-center gap-1 mr-0.5">
                      <Calendar size={10} /> {currentMonth}
                    </span>
                    {seasonalTips.map(tip => (
                      <span key={tip} className="text-[11px] font-medium bg-white/15 px-2.5 py-0.5 rounded-full">{tip}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {lastResult && (
              <div className="sm:text-right shrink-0 space-y-1">
                {lastResult.createdAt && (
                  <p className="text-xs font-semibold">
                    {lastResult.auto ? 'Weekly ideas' : 'Generated'} · {shortDate(lastResult.createdAt)}
                  </p>
                )}
                {lastResult.source && lastResult.source !== 'fallback' && (
                  <span className={`inline-block text-[10px] font-bold px-2.5 py-1 rounded-full ${lastResult.source === 'ai' ? 'bg-white/20' : 'bg-black/20'}`}>
                    {lastResult.source === 'ai' ? `AI · ${lastResult.model || lastResult.provider || 'unknown'}` : 'Offline'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3">
            <AlertCircle size={16} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-600 flex-1">{error}</p>
            <button onClick={fetchSuggestions} className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1.5 rounded-full hover:bg-red-200 shrink-0">Retry</button>
          </div>
        )}

        {loading && !suggestions && (
          <div className="grid sm:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-44 bg-white border border-gray-100 rounded-3xl shimmer" />)}
          </div>
        )}

        {!suggestions && !loading && !error && (
          <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-8 text-center">
            <Lightbulb size={26} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm font-semibold text-gray-700">No ideas yet</p>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">Generate suggestions to see which pieces to discount and which codes to run this {currentMonth}.</p>
            <button onClick={fetchSuggestions}
              className="mt-4 inline-flex items-center gap-1.5 h-10 px-5 rounded-xl text-xs font-bold text-white bg-[#bf4a53] hover:bg-red-700 transition-colors">
              <Sparkles size={14} /> Get AI ideas
            </button>
          </div>
        )}

        {suggestions && (
          <>
            {/* Item sale ideas */}
            {pendingItems.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-gray-900">Items to discount</h3>
                    <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{pendingItems.length}</span>
                  </div>
                  {unappliedItems.length > 1 && (
                    <button onClick={handleApplyAll} disabled={!!applyingKey}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl text-xs font-bold text-[#bf4a53] bg-rose-50 hover:bg-rose-100 transition-colors disabled:opacity-50">
                      {applyingKey === '__all__' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      Apply all {unappliedItems.length}
                    </button>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {pendingItems.map(s => {
                    const key = suggestionKey(s);
                    const item = findItem(s);
                    const isApplied = appliedItems.has(key);
                    const price = item?.price || 0;
                    const salePrice = price * (1 - s.discountPct / 100);
                    const open = expanded.has('r-' + key);
                    return (
                      <article key={key} className={`bg-white rounded-3xl border p-4 flex flex-col transition-all ${isApplied ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100/80 shadow-sm hover:shadow'}`}>
                        <div className="flex gap-3">
                          <div className="relative w-20 h-24 rounded-2xl overflow-hidden bg-gray-100 shrink-0">
                            <ItemImage thumb image={item?.image} alt={s.itemName} className="w-full h-full object-cover" placeholderSize={20} />
                            <span className="absolute top-1.5 left-1.5 text-[10px] font-bold text-white bg-[#bf4a53] px-1.5 py-0.5 rounded-md shadow-sm">-{s.discountPct}%</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-gray-900 leading-snug line-clamp-2">{s.itemName}</p>
                            {item?.category && <p className="text-[11px] text-gray-400 mt-0.5">{item.category} · {item.rentalCount ?? 0} rental{(item.rentalCount ?? 0) !== 1 ? 's' : ''}</p>}
                            {price > 0 && (
                              <p className="mt-2 flex items-baseline gap-2">
                                <span className="text-lg font-bold text-gray-900 tabular-nums">{peso(salePrice)}</span>
                                <span className="text-xs text-gray-400 line-through tabular-nums">{peso(price)}</span>
                              </p>
                            )}
                            {s.suggestedExpiryDays && (
                              <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1"><Clock size={11} /> Runs {s.suggestedExpiryDays} days</p>
                            )}
                            {!item && <p className="text-[11px] text-amber-600 font-semibold mt-1">No longer in inventory</p>}
                          </div>
                        </div>
                        {s.rationale && (
                          <button type="button" onClick={() => toggleExpanded('r-' + key)}
                            className={`mt-3 text-left text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-xl px-3 py-2 hover:bg-gray-100/80 transition-colors ${open ? '' : 'line-clamp-2'}`}>
                            {s.rationale}
                          </button>
                        )}
                        <div className="mt-auto pt-3 flex items-center gap-2">
                          {isApplied ? (
                            <span className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-100/70">
                              <Check size={13} /> On sale now
                            </span>
                          ) : (
                            <>
                              <button onClick={() => setDismissedItems(prev => new Set([...prev, key]))}
                                className="h-9 px-3 rounded-xl text-xs font-semibold text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors">Dismiss</button>
                              {onEditItem && item && (
                                <IconButton label="Adjust in item editor" onClick={() => handleEditFirst(s)}><Pencil size={15} /></IconButton>
                              )}
                              <button onClick={() => handleApplyOne(s)} disabled={!item || !!applyingKey}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-bold text-white bg-gray-900 hover:bg-gray-800 transition-colors disabled:opacity-40">
                                {applyingKey === key ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />}
                                Put on sale
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Voucher ideas */}
            {vouchers.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-900">Codes to run</h3>
                  <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{vouchers.length}</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {vouchers.map(s => {
                    const isApplied = appliedVouchers.has(s.code);
                    const open = expanded.has('v-' + s.code);
                    return (
                      <article key={s.code} className="bg-white rounded-3xl border border-gray-100/80 shadow-sm flex flex-col overflow-hidden">
                        <div className="flex items-center gap-3 p-4 border-b border-dashed border-gray-200">
                          <span className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Percent size={18} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="font-mono font-bold text-gray-900 tracking-wide truncate">{s.code}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              {s.discountPct}% off
                              {s.maxUses ? ` · up to ${s.maxUses} uses` : ''}
                              {s.expiresInDays ? ` · ${s.expiresInDays} days` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="p-4 pt-3 flex flex-col flex-1">
                          {s.rationale && (
                            <button type="button" onClick={() => toggleExpanded('v-' + s.code)}
                              className={`text-left text-xs text-gray-500 leading-relaxed hover:text-gray-700 transition-colors ${open ? '' : 'line-clamp-3'}`}>
                              {s.rationale}
                            </button>
                          )}
                          <div className="mt-auto pt-3">
                            <button onClick={() => handleCreateCode(s)} disabled={isApplied}
                              className={`w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-xl text-xs font-bold transition-colors ${
                                isApplied ? 'bg-emerald-100/70 text-emerald-700' : 'bg-emerald-500 text-white hover:bg-emerald-600'
                              }`}>
                              {isApplied ? <><Check size={13} /> Sent to Promo Codes</> : 'Create code'}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {suggestions.itemSuggestions?.length === 0 && vouchers.length === 0 && (
              <div className="bg-white rounded-3xl border border-gray-100 p-8 text-center">
                <Lightbulb size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No promotions needed right now — inventory looks well-optimized.</p>
              </div>
            )}
            {suggestions.itemSuggestions?.length > 0 && pendingItems.length === 0 && vouchers.length === 0 && (
              <div className="bg-white rounded-3xl border border-gray-100 p-8 text-center">
                <Undo2 size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">All ideas dismissed.</p>
                <button onClick={() => setDismissedItems(new Set())} className="mt-2 text-xs font-bold text-[#bf4a53] hover:underline">Show them again</button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Item Sales ───────────────────────────────────────────── */}
      <section hidden={tab !== 'sales'}>
        <BulkSaleManager items={sellable} onSalePatch={onSalePatch} filter={salesFilter} onFilterChange={setSalesFilter} />
      </section>

      {/* ── Promo Codes ──────────────────────────────────────────── */}
      <section hidden={tab !== 'codes'}>
        <PromoCodesManager
          initialForm={promoFormPrefill}
          onClearInitialForm={() => setPromoFormPrefill(null)}
          onCodesChange={setPromoCodes}
        />
      </section>

      {/* ── History sheet (list → detail) ────────────────────────── */}
      {historyOpen && (
        <BottomSheet onClose={closeHistory} labelledby="dialog-title-ai-history" z="z-[200]" maxWidth="sm:max-w-lg">
              <div className="shrink-0 flex items-center gap-2 p-5 border-b border-gray-100/80">
                {viewingSaved && (
                  <IconButton label="Back to history" onClick={() => { setViewingSaved(null); setViewingSavedData(null); setViewingError(''); }}>
                    <ChevronLeft size={18} />
                  </IconButton>
                )}
                <div className="min-w-0 flex-1">
                  <h3 id="dialog-title-ai-history" className="font-bold text-gray-900">{viewingSaved ? (viewingSaved.currentMonth || 'Saved suggestion') : 'Suggestion history'}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {viewingSaved
                      ? new Date(viewingSaved.createdAt).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : 'Past AI runs — open one to review or reuse it'}
                  </p>
                </div>
                {viewingSaved && (
                  <button onClick={() => loadSuggestionAsCurrent(viewingSavedData)} disabled={!viewingSavedData?.suggestions}
                    className="text-xs font-bold text-[#bf4a53] bg-rose-50 px-3 py-2 rounded-xl hover:bg-rose-100 transition-colors disabled:opacity-40 shrink-0">
                    Use these ideas
                  </button>
                )}
                <IconButton label="Close" onClick={closeHistory}><X size={18} /></IconButton>
              </div>

              <div data-sheet-scroll className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-4 min-h-0">
                {!viewingSaved ? (
                  savedLoading ? (
                    <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-50 rounded-2xl shimmer" />)}</div>
                  ) : savedError ? (
                    <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3">
                      <AlertCircle size={16} className="text-red-400 shrink-0" />
                      <p className="text-sm text-red-600 flex-1">{savedError}</p>
                      <button onClick={loadSaved} className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1.5 rounded-full hover:bg-red-200 shrink-0">Retry</button>
                    </div>
                  ) : savedList.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8 panel-center">No saved suggestions yet.</p>
                  ) : (
                    <>
                      <ul className="divide-y divide-gray-100 border border-gray-100 rounded-2xl overflow-hidden">
                        {savedPaged.map(meta => (
                          <li key={meta.id} className="flex items-center gap-2 hover:bg-gray-50 transition-colors">
                            <button type="button" onClick={() => viewSavedSuggestion(meta)} className="flex-1 min-w-0 text-left px-4 py-3">
                              <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-2">
                                <span className="truncate">{meta.excerpt || meta.currentMonth || 'Suggestion'}</span>
                                {meta.createdBy == null && <span className="shrink-0 text-[10px] font-bold text-[#bf4a53] bg-rose-50 px-2 py-0.5 rounded-full">Weekly</span>}
                              </p>
                              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                                {new Date(meta.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                {meta.model ? ` · ${meta.model}` : meta.provider ? ` · ${meta.provider}` : ''}
                              </p>
                            </button>
                            <div className="pr-2 shrink-0">
                              <IconButton label="Delete suggestion" tone="danger" onClick={() => deleteSavedSuggestion(meta.id)} disabled={deletingId === meta.id}>
                                {deletingId === meta.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                              </IconButton>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <Pagination page={savedPage} totalPages={savedTotalPages}
                        onPageChange={(p) => setSavedPage(Math.min(savedTotalPages, Math.max(1, p)))} />
                    </>
                  )
                ) : viewingLoading ? (
                  <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-20 bg-gray-50 rounded-2xl shimmer" />)}</div>
                ) : viewingError ? (
                  <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3">
                    <AlertCircle size={16} className="text-red-400 shrink-0" />
                    <p className="text-sm text-red-600 flex-1">{viewingError}</p>
                    <button onClick={() => viewSavedSuggestion(viewingSaved)} className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1.5 rounded-full hover:bg-red-200 shrink-0">Retry</button>
                  </div>
                ) : viewingSavedData?.suggestions ? (
                  <>
                    {viewingSavedData.suggestions.itemSuggestions?.length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Tag size={11} /> Item sales</h4>
                        <div className="space-y-2">
                          {viewingSavedData.suggestions.itemSuggestions.map((s, i) => (
                            <div key={i} className="p-3 bg-gray-50 rounded-xl">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-bold text-gray-900 truncate">{s.itemName}</span>
                                <span className="text-[10px] font-bold bg-rose-50 text-[#bf4a53] px-2 py-0.5 rounded-full shrink-0">{s.discountPct}% off</span>
                              </div>
                              <p className="text-xs text-gray-500 leading-relaxed">{s.rationale}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {viewingSavedData.suggestions.voucherSuggestions?.length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Percent size={11} /> Codes</h4>
                        <div className="space-y-2">
                          {viewingSavedData.suggestions.voucherSuggestions.map((s, i) => (
                            <div key={i} className="p-3 bg-gray-50 rounded-xl">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-bold font-mono text-gray-900">{s.code}</span>
                                <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">{s.discountPct}% off</span>
                                {s.maxUses && <span className="text-[10px] text-gray-400">max {s.maxUses}</span>}
                              </div>
                              <p className="text-xs text-gray-500 leading-relaxed">{s.rationale}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-6">No suggestion data available.</p>
                )}
              </div>
        </BottomSheet>
      )}
    </div>
  );
}
