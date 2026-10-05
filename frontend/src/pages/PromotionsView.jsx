import { useState, useCallback, useEffect } from 'react';
import { Sparkles, Tag, Percent, RefreshCw, Lightbulb, ArrowRight, Loader2, AlertCircle, Clock, Trash2, Eye, ChevronLeft, ChevronRight, Calendar, X, Check, Undo2 } from 'lucide-react';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';
import ItemImage from '../components/ItemImage';
import PromoCodesManager from '../components/PromoCodesManager';
import BulkSaleManager from '../components/BulkSaleManager';

// ─── Caching ───────────────────────────────────────────────────────────
const CACHE_KEY = 'rentech_promo_suggestions';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const suggestCache = new Map();

function readCache() {
  const mem = suggestCache.get('current');
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) return mem.data;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.at < CACHE_TTL_MS) {
        suggestCache.set('current', { data: parsed.data, at: parsed.at });
        return parsed.data;
      }
    }
  } catch {}
  return null;
}

function writeCache(data) {
  const entry = { data, at: Date.now() };
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

const PAGE_SIZE = 5;

export default function PromotionsView({ inventory, onEditItem }) {
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [promoFormPrefill, setPromoFormPrefill] = useState(null);
  const [appliedItems, setAppliedItems] = useState(new Set());
  const [appliedVouchers, setAppliedVouchers] = useState(new Set());
  const [dismissedItems, setDismissedItems] = useState(new Set());
  const [applyingAll, setApplyingAll] = useState(false);
  const [expandedNames, setExpandedNames] = useState(new Set());

  // Saved suggestions history
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

  useEffect(() => {
    const cached = readCache();
    if (cached) setSuggestions(cached);
  }, []);

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
  const [lastResult, setLastResult] = useState(null);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.post('/ai/suggest-promos');
      const data = result.suggestions || { itemSuggestions: [], voucherSuggestions: [] };
      setSuggestions(data);
      setLastResult(result);
      setDismissedItems(new Set());
      setExpandedNames(new Set());
      writeCache(data);
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
  }, [loadSaved, toastSuccess, toastError]);

  // ─── Apply sale to item ──────────────────────────────────────────
  const handleApplyToItem = (suggestion) => {
    const item = inventory?.find(i => i.id === suggestion.itemId || i.name === suggestion.itemName);
    if (!item) {
      toastError(`"${suggestion.itemName}" not found in inventory — it may have been removed.`);
      return;
    }
    if (!onEditItem) return;
    onEditItem({
      ...item,
      onSale: true,
      discountPct: suggestion.discountPct,
      saleEndsAt: suggestion.suggestedExpiryDays
        ? new Date(Date.now() + suggestion.suggestedExpiryDays * 86400000).toISOString().split('T')[0]
        : undefined,
    });
    setAppliedItems(prev => new Set([...prev, suggestion.itemId || suggestion.itemName]));
    toastSuccess(`Opened ${item.name} for editing — sale fields pre-filled`);
  };

  // ─── Create promo code ───────────────────────────────────────────
  const handleCreateCode = (suggestion) => {
    const expiresAt = suggestion.expiresInDays
      ? new Date(Date.now() + suggestion.expiresInDays * 86400000).toISOString().split('T')[0]
      : '';
    setPromoFormPrefill({
      code: suggestion.code,
      discountPct: suggestion.discountPct,
      maxUses: String(suggestion.maxUses || ''),
      expiresAt,
    });
    setAppliedVouchers(prev => new Set([...prev, suggestion.code]));
    document.getElementById('promo-codes-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toastSuccess(`Promo code "${suggestion.code}" ready to create — review and confirm below`);
  };

  // ─── View saved suggestion ───────────────────────────────────────
  const viewSavedSuggestion = async (meta) => {
    setViewingSaved(meta);
    setViewingSavedData(null);
    setViewingError('');
    setViewingLoading(true);
    try {
      const full = await api.get(`/ai/promo-suggestions/${meta.id}`);
      setViewingSavedData(full);
    } catch (err) {
      setViewingError(formatError(err));
      toastError(formatError(err));
    } finally {
      setViewingLoading(false);
    }
  };

  // ─── Delete saved suggestion ─────────────────────────────────────
  const deleteSavedSuggestion = async (id) => {
    if (!window.confirm('Delete this saved suggestion?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/ai/promo-suggestions/${id}`);
      setSavedList(prev => prev.filter(s => s.id !== id));
      toastSuccess('Suggestion deleted');
    } catch (err) {
      toastError(formatError(err));
    } finally {
      setDeletingId(null);
    }
  };

  // ─── Load saved suggestion as current ────────────────────────────
  const loadSuggestionAsCurrent = (full) => {
    if (full?.suggestions) {
      setSuggestions(full.suggestions);
      writeCache(full.suggestions);
      setViewingSaved(null);
      setViewingSavedData(null);
      setAppliedItems(new Set());
      setAppliedVouchers(new Set());
      setDismissedItems(new Set());
      setExpandedNames(new Set());
      toastSuccess('Loaded saved suggestion as current');
    }
  };

  // ─── Apply All Suggestions ────────────────────────────────────────
  const handleApplyAll = useCallback(async () => {
    if (!suggestions || !onEditItem) return;
    setApplyingAll(true);
    let applied = 0;
    for (const s of suggestions.itemSuggestions || []) {
      if (appliedItems.has(s.itemId || s.itemName) || dismissedItems.has(s.itemId || s.itemName)) continue;
      const item = inventory?.find(i => i.id === s.itemId || i.name === s.itemName);
      if (!item) continue;
      onEditItem({
        ...item,
        onSale: true,
        discountPct: s.discountPct,
        saleEndsAt: s.suggestedExpiryDays
          ? new Date(Date.now() + s.suggestedExpiryDays * 86400000).toISOString().split('T')[0]
          : undefined,
      });
      setAppliedItems(prev => new Set([...prev, s.itemId || s.itemName]));
      applied++;
      // Small delay between items to avoid React batching issues
      await new Promise(r => setTimeout(r, 50));
    }
    setApplyingAll(false);
    if (applied > 0) {
      toastSuccess(`Applied ${applied} item sale${applied !== 1 ? 's' : ''} — review each in Inventory`);
    } else {
      toastSuccess('All suggestions already applied or dismissed');
    }
  }, [suggestions, inventory, onEditItem, appliedItems, dismissedItems, toastSuccess]);

  const savedTotalPages = Math.max(1, Math.ceil(savedList.length / PAGE_SIZE));
  const savedPaged = savedList.slice((savedPage - 1) * PAGE_SIZE, savedPage * PAGE_SIZE);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Promotions</h2>
        <p className="text-sm text-gray-500 font-medium mt-1">Manage promo codes, item sales, and get AI-powered suggestions.</p>
      </div>

      {/* AI Promo Advisor */}
      <div className="bg-gradient-to-br from-[#bf4a53] to-red-600 rounded-3xl p-4 md:p-8 text-white shadow-lg shadow-[#bf4a53]/20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
              <Sparkles size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="font-bold text-sm sm:text-base leading-tight">AI Promotion Advisor</h3>
              <p className="text-white/60 text-[10px] sm:text-xs mt-0.5 truncate">Inventory + seasonal + revenue</p>
            </div>
          </div>
          <button
            onClick={fetchSuggestions}
            disabled={loading}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] sm:text-xs font-bold bg-white/20 hover:bg-white/30 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {loading ? 'Analyzing…' : suggestions ? 'Refresh' : 'Get Suggestions'}
          </button>
        </div>

        {seasonalTips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider mr-1 flex items-center gap-1">
              <Calendar size={10} /> {currentMonth}:
            </span>
            {seasonalTips.map((tip, i) => (
              <span key={i} className="text-[10px] font-medium bg-white/15 px-2 py-0.5 rounded-full">{tip}</span>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 bg-white/10 rounded-2xl p-3 flex items-center gap-2 text-sm">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={fetchSuggestions} className="text-[11px] font-bold bg-white/20 px-3 py-1 rounded-full hover:bg-white/30 shrink-0">
              Retry
            </button>
          </div>
        )}

        {suggestions && (
          <div className="mt-4 sm:mt-6 space-y-4 sm:space-y-5">
            {lastResult?.source && lastResult.source !== 'fallback' && (
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  lastResult.source === 'ai' ? 'bg-white/20 text-white' : 'bg-red-500/30 text-red-100'
                }`}>
                  {lastResult.source === 'ai' ? `AI · ${lastResult.provider || 'unknown'}` : 'Offline'}
                </span>
                {lastResult.model && (
                  <span className="text-[10px] text-white/40">{lastResult.model}</span>
                )}
              </div>
            )}
            {suggestions.itemSuggestions?.length > 0 && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Tag size={14} className="text-white/70 shrink-0" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white/70 truncate">Item Sales</h4>
                    <span className="text-[10px] bg-white/15 px-2 py-0.5 rounded-full shrink-0">{suggestions.itemSuggestions.length - [...dismissedItems].filter(d => suggestions.itemSuggestions.some(s => (s.itemId || s.itemName) === d)).length} active</span>
                  </div>
                  {suggestions.itemSuggestions.some(s => !appliedItems.has(s.itemId || s.itemName) && !dismissedItems.has(s.itemId || s.itemName)) && onEditItem && (
                    <button
                      onClick={handleApplyAll}
                      disabled={applyingAll}
                      className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold bg-white text-[#bf4a53] hover:bg-white/90 transition-colors disabled:opacity-50"
                    >
                      {applyingAll ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                      Apply All
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {suggestions.itemSuggestions.map((s, i) => {
                    const isApplied = appliedItems.has(s.itemId || s.itemName);
                    const isDismissed = dismissedItems.has(s.itemId || s.itemName);
                    const item = inventory?.find(inv => inv.id === s.itemId || inv.name === s.itemName);
                    const currentPrice = item?.price || 0;
                    const salePrice = currentPrice * (1 - s.discountPct / 100);
                    if (isDismissed) return null;
                    return (
                      <div key={i} className={`bg-white/10 rounded-2xl p-3 md:p-4 backdrop-blur-sm transition-all ${isApplied ? 'ring-1 ring-white/30' : ''}`}>
                        {/* Mobile: stacked layout */}
                        <div className="md:hidden">
                          <div className="flex gap-3">
                            <div className="w-16 h-16 rounded-xl overflow-hidden bg-white/10 shrink-0">
                              <ItemImage thumb image={item?.image} alt={s.itemName} className="w-full h-full object-cover" placeholderSize={18} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="text-sm font-bold leading-tight">{s.itemName}</p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">{s.discountPct}% off</span>
                                {s.suggestedExpiryDays && (
                                  <span className="text-[10px] text-white/40 flex items-center gap-1">
                                    <Clock size={9} /> {s.suggestedExpiryDays}d
                                  </span>
                                )}
                              </div>
                              {currentPrice > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-white/40 line-through">₱{currentPrice.toLocaleString()}</span>
                                  <span className="text-[11px] font-bold text-emerald-300">₱{salePrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                </div>
                              )}
                              <p
                                onClick={() => setExpandedNames(prev => { const n = new Set(prev); const k = 'r-' + (s.itemId || s.itemName); n.has(k) ? n.delete(k) : n.add(k); return n; })}
                                className={`text-white/60 text-xs cursor-pointer select-none hover:text-white/80 transition-colors ${expandedNames.has('r-' + (s.itemId || s.itemName)) ? '' : 'line-clamp-2'}`}
                                title={s.rationale}
                              >{s.rationale}</p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-white/10">
                            <button onClick={() => setDismissedItems(prev => new Set([...prev, s.itemId || s.itemName]))}
                              className="text-[11px] text-white/40 hover:text-white/70 transition-colors">Dismiss</button>
                            <button onClick={() => handleApplyToItem(s)} disabled={isApplied}
                              className={`flex items-center gap-1 px-4 py-1.5 rounded-full text-[11px] font-bold transition-colors ${isApplied ? 'bg-white/10 text-white/40 cursor-default' : 'bg-white text-[#bf4a53] hover:bg-white/90'}`}>
                              {isApplied ? 'Applied' : 'Apply'}{!isApplied && <ArrowRight size={11} />}
                            </button>
                          </div>
                        </div>
                        {/* Desktop/tablet: horizontal layout */}
                        <div className="hidden md:flex items-start gap-4">
                          <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/10 shrink-0">
                            <ItemImage thumb image={item?.image} alt={s.itemName} className="w-full h-full object-cover" placeholderSize={22} />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <p className="text-sm font-bold leading-tight">{s.itemName}</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] font-bold bg-white/20 px-2.5 py-0.5 rounded-full">{s.discountPct}% off</span>
                              {s.suggestedExpiryDays && (
                                <span className="text-[11px] text-white/50 flex items-center gap-1"><Clock size={10} /> {s.suggestedExpiryDays}d</span>
                              )}
                              {currentPrice > 0 && (
                                <span className="text-[11px] text-white/50">
                                  <span className="line-through">₱{currentPrice.toLocaleString()}</span>
                                  {' '}<span className="font-bold text-emerald-300">₱{salePrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                </span>
                              )}
                            </div>
                            <p className="text-white/60 text-xs leading-relaxed">{s.rationale}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {!isApplied && (
                              <button onClick={() => setDismissedItems(prev => new Set([...prev, s.itemId || s.itemName]))}
                                className="text-[11px] text-white/40 hover:text-white/70 transition-colors px-2 py-2">Dismiss</button>
                            )}
                            <button onClick={() => handleApplyToItem(s)} disabled={isApplied}
                              className={`flex items-center gap-1 px-4 py-2 rounded-full text-xs font-bold transition-colors ${isApplied ? 'bg-white/10 text-white/40 cursor-default' : 'bg-white text-[#bf4a53] hover:bg-white/90'}`}>
                              {isApplied ? 'Applied' : 'Apply'}{!isApplied && <ArrowRight size={12} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {suggestions.voucherSuggestions?.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Percent size={14} className="text-white/70 shrink-0" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white/70 truncate">Voucher Codes</h4>
                  <span className="text-[10px] bg-white/15 px-2 py-0.5 rounded-full shrink-0">{suggestions.voucherSuggestions.length}</span>
                </div>
                <div className="space-y-2">
                  {suggestions.voucherSuggestions.map((s, i) => {
                    const isApplied = appliedVouchers.has(s.code);
                    return (
                      <div key={i} className="bg-white/10 rounded-2xl p-3 md:p-4 backdrop-blur-sm">
                        {/* Mobile: stacked */}
                        <div className="md:hidden space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold font-mono">{s.code}</p>
                            <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">{s.discountPct}% off</span>
                            {s.maxUses && <span className="text-[10px] text-white/50">max {s.maxUses}</span>}
                            {s.expiresInDays && (
                              <span className="text-[10px] text-white/40 flex items-center gap-1"><Clock size={9} /> {s.expiresInDays}d</span>
                            )}
                          </div>
                          <p
                            onClick={() => setExpandedNames(prev => { const n = new Set(prev); const k = 'v-' + s.code; n.has(k) ? n.delete(k) : n.add(k); return n; })}
                            className={`text-white/60 text-xs cursor-pointer select-none hover:text-white/80 transition-colors ${expandedNames.has('v-' + s.code) ? '' : 'line-clamp-2'}`}
                            title={s.rationale}
                          >{s.rationale}</p>
                          <div className="flex items-center justify-end pt-2 border-t border-white/10">
                            <button onClick={() => handleCreateCode(s)} disabled={isApplied}
                              className={`flex items-center gap-1 px-4 py-1.5 rounded-full text-[11px] font-bold transition-colors ${isApplied ? 'bg-white/10 text-white/40 cursor-default' : 'bg-white text-[#bf4a53] hover:bg-white/90'}`}>
                              {isApplied ? 'Created' : 'Create Code'}{!isApplied && <ArrowRight size={11} />}
                            </button>
                          </div>
                        </div>
                        {/* Desktop/tablet: horizontal */}
                        <div className="hidden md:flex items-start gap-4">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <p className="text-sm font-bold font-mono">{s.code}</p>
                              <span className="text-[11px] font-bold bg-white/20 px-2.5 py-0.5 rounded-full">{s.discountPct}% off</span>
                              {s.maxUses && <span className="text-[11px] text-white/50">max {s.maxUses}</span>}
                              {s.expiresInDays && (
                                <span className="text-[11px] text-white/50 flex items-center gap-1"><Clock size={10} /> {s.expiresInDays}d</span>
                              )}
                            </div>
                            <p className="text-white/60 text-xs leading-relaxed">{s.rationale}</p>
                          </div>
                          <button onClick={() => handleCreateCode(s)} disabled={isApplied}
                            className={`shrink-0 flex items-center gap-1 px-4 py-2 rounded-full text-xs font-bold transition-colors ${isApplied ? 'bg-white/10 text-white/40 cursor-default' : 'bg-white text-[#bf4a53] hover:bg-white/90'}`}>
                            {isApplied ? 'Created' : 'Create Code'}{!isApplied && <ArrowRight size={12} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {suggestions.itemSuggestions?.length === 0 && suggestions.voucherSuggestions?.length === 0 && (
              <div className="text-center py-4">
                <Lightbulb size={24} className="mx-auto text-white/40 mb-2" />
                <p className="text-sm text-white/60">No suggestions at this time. Inventory looks well-optimized!</p>
              </div>
            )}
            {suggestions.itemSuggestions?.length > 0 && dismissedItems.size === suggestions.itemSuggestions.length && suggestions.voucherSuggestions?.length === 0 && (
              <div className="text-center py-4">
                <Undo2 size={24} className="mx-auto text-white/40 mb-2" />
                <p className="text-sm text-white/60">All suggestions dismissed. Click "Refresh" for new suggestions.</p>
              </div>
            )}
          </div>
        )}

        {!suggestions && !loading && !error && (
          <div className="mt-6 text-center py-4">
            <Lightbulb size={24} className="mx-auto text-white/40 mb-2" />
            <p className="text-sm text-white/60">Click "Get Suggestions" to analyze inventory, revenue, and seasonal trends.</p>
          </div>
        )}
      </div>

      {/* Saved Suggestions History */}
      <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-4">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-gray-900 text-base">Saved Suggestions</h3>
            <p className="text-xs text-gray-500 mt-0.5">Previously generated AI suggestions — view or reapply</p>
          </div>
          {!savedLoading && savedList.length > 0 && (
            <button onClick={loadSaved} className="text-[11px] text-gray-400 hover:text-gray-600 font-medium shrink-0">Refresh</button>
          )}
        </div>

        {savedLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-50 rounded-2xl shimmer" />)}
          </div>
        ) : savedError ? (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3">
            <AlertCircle size={16} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-600 flex-1">{savedError}</p>
            <button onClick={loadSaved} className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1.5 rounded-full hover:bg-red-200 shrink-0">
              Retry
            </button>
          </div>
        ) : savedList.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No saved suggestions yet. Generate your first set above!</p>
        ) : (
          <>
            <div className="space-y-2">
              {savedPaged.map(meta => (
                <div key={meta.id} className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-gray-100 bg-gray-50/70 hover:bg-gray-50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900">{meta.currentMonth || 'Unknown month'}</p>
                      {meta.provider && (
                        <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{meta.provider}</span>
                      )}
                      {meta.model && (
                        <span className="text-[10px] text-gray-400">{meta.model}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{meta.excerpt}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(meta.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {meta.uploaded && <span className="ml-2 text-emerald-500">cloud</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => viewSavedSuggestion(meta)} disabled={viewingLoading}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors disabled:opacity-40" title="View">
                      <Eye size={15} />
                    </button>
                    <button onClick={() => deleteSavedSuggestion(meta.id)} disabled={deletingId === meta.id}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors disabled:opacity-40" title="Delete">
                      {deletingId === meta.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {savedTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-1">
                <button onClick={() => setSavedPage(p => Math.max(1, p - 1))} disabled={savedPage === 1}
                  className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"><ChevronLeft size={14} /></button>
                <span className="text-[11px] text-gray-500">{savedPage}/{savedTotalPages}</span>
                <button onClick={() => setSavedPage(p => Math.min(savedTotalPages, p + 1))} disabled={savedPage === savedTotalPages}
                  className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"><ChevronRight size={14} /></button>
              </div>
            )}
          </>
        )}
      </div>

      {/* View Saved Suggestion Modal */}
      {viewingSaved && (
        <div className="fixed inset-0 z-[200] transition-opacity duration-150">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => { setViewingSaved(null); setViewingSavedData(null); setViewingError(''); }} />
          <div className="fixed inset-0 flex items-end sm:items-center justify-center px-0 pt-10 pb-0 sm:p-4 pointer-events-none">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg sheet-cap sm:max-h-[90vh] max-h-[92dvh] flex flex-col overflow-hidden pointer-events-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="shrink-0 flex items-center justify-between p-5 sm:p-6 border-b border-gray-100/80 rounded-t-3xl">
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900">{viewingSaved.currentMonth || 'Saved Suggestion'}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(viewingSaved.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => loadSuggestionAsCurrent(viewingSavedData)} disabled={!viewingSavedData?.suggestions}
                    className="text-xs font-bold text-[#bf4a53] bg-rose-50 px-3 py-1.5 rounded-full hover:bg-rose-100 transition-colors disabled:opacity-40">
                    Load as Current
                  </button>
                  <button onClick={() => { setViewingSaved(null); setViewingSavedData(null); setViewingError(''); }}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"><X size={16} /></button>
                </div>
              </div>
              <div className="overflow-y-auto px-5 sm:px-6 pb-6 pt-4 space-y-5 min-h-0">
                {viewingLoading ? (
                  <div className="space-y-3">
                    {[1,2].map(i => <div key={i} className="h-24 bg-gray-50 rounded-2xl shimmer" />)}
                  </div>
                ) : viewingError ? (
                  <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3">
                    <AlertCircle size={16} className="text-red-400 shrink-0" />
                    <p className="text-sm text-red-600 flex-1">{viewingError}</p>
                    <button onClick={() => viewSavedSuggestion(viewingSaved)} className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1.5 rounded-full hover:bg-red-200 shrink-0">
                      Retry
                    </button>
                  </div>
                ) : viewingSavedData?.suggestions ? (
                  <>
                    {viewingSavedData.suggestions.itemSuggestions?.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-1.5"><Tag size={11} /> Item Sales</h4>
                        <div className="space-y-3">
                          {viewingSavedData.suggestions.itemSuggestions.map((s, i) => (
                            <div key={i} className="p-4 bg-gray-50 rounded-xl">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-sm font-bold text-gray-900">{s.itemName}</span>
                                <span className="text-[10px] font-bold bg-rose-50 text-[#bf4a53] px-2 py-0.5 rounded-full">{s.discountPct}% off</span>
                              </div>
                              <p className="text-xs text-gray-500 leading-relaxed">{s.rationale}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {viewingSavedData.suggestions.voucherSuggestions?.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase mb-3 flex items-center gap-1.5"><Percent size={11} /> Vouchers</h4>
                        <div className="space-y-3">
                          {viewingSavedData.suggestions.voucherSuggestions.map((s, i) => (
                            <div key={i} className="p-4 bg-gray-50 rounded-xl">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-sm font-bold font-mono text-gray-900">{s.code}</span>
                                <span className="text-[10px] font-bold bg-rose-50 text-[#bf4a53] px-2 py-0.5 rounded-full">{s.discountPct}% off</span>
                                <span className="text-[10px] text-gray-400">max {s.maxUses}</span>
                              </div>
                              <p className="text-xs text-gray-500 leading-relaxed">{s.rationale}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-4">No suggestion data available.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Promo Codes Manager */}
      <div id="promo-codes-section">
        <PromoCodesManager
          initialForm={promoFormPrefill}
          onClearInitialForm={() => setPromoFormPrefill(null)}
        />
      </div>

      {/* Bulk Sale Manager */}
      <BulkSaleManager />
    </div>
  );
}
