import { useState, useCallback, useEffect, useRef } from 'react';
import { Sparkles, Tag, Percent, RefreshCw, Lightbulb, ArrowRight, Loader2, AlertCircle, Clock, Trash2, Eye, ChevronLeft, ChevronRight, Calendar, TrendingUp, X } from 'lucide-react';
import { api } from '../utils/api';
import PromoCodesManager from '../components/PromoCodesManager';
import BulkSaleManager from '../components/BulkSaleManager';

// ─── Caching ───────────────────────────────────────────────────────────
const CACHE_KEY = 'rentech_promo_suggestions';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
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

function clearCache() {
  suggestCache.delete('current');
  try { localStorage.removeItem(CACHE_KEY); } catch {}
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
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [promoFormPrefill, setPromoFormPrefill] = useState(null);
  const [appliedItems, setAppliedItems] = useState(new Set());
  const [appliedVouchers, setAppliedVouchers] = useState(new Set());

  // Saved suggestions history
  const [savedList, setSavedList] = useState([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedPage, setSavedPage] = useState(1);
  const [viewingSaved, setViewingSaved] = useState(null);
  const [viewingSavedData, setViewingSavedData] = useState(null);
  const [viewingLoading, setViewingLoading] = useState(false);

  // Current month for seasonal display
  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' });
  const seasonalTips = SEASONAL_EVENTS[currentMonth] || [];

  // Load cached suggestions on mount
  useEffect(() => {
    const cached = readCache();
    if (cached) setSuggestions(cached);
  }, []);

  // Load saved suggestions history
  const loadSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      const data = await api.get('/ai/promo-suggestions');
      setSavedList(Array.isArray(data) ? data : []);
    } catch {
      setSavedList([]);
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.post('/ai/suggest-promos');
      const data = result.suggestions || { itemSuggestions: [], voucherSuggestions: [] };
      setSuggestions(data);
      writeCache(data);
      // Refresh saved list after auto-save
      loadSaved();
    } catch (err) {
      setError(err.message || 'Failed to get AI suggestions');
    } finally {
      setLoading(false);
    }
  }, [loadSaved]);

  const handleApplyToItem = (suggestion) => {
    const item = inventory?.find(i => i.id === suggestion.itemId || i.name === suggestion.itemName);
    if (item && onEditItem) {
      onEditItem({
        ...item,
        onSale: true,
        discountPct: suggestion.discountPct,
        saleEndsAt: suggestion.suggestedExpiryDays
          ? new Date(Date.now() + suggestion.suggestedExpiryDays * 86400000).toISOString().split('T')[0]
          : undefined,
      });
    }
    setAppliedItems(prev => new Set([...prev, suggestion.itemId || suggestion.itemName]));
  };

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
  };

  const viewSavedSuggestion = async (meta) => {
    setViewingSaved(meta);
    setViewingLoading(true);
    try {
      const full = await api.get(`/ai/promo-suggestions/${meta.id}`);
      setViewingSavedData(full);
    } catch {
      setViewingSavedData(null);
    } finally {
      setViewingLoading(false);
    }
  };

  const deleteSavedSuggestion = async (id) => {
    if (!window.confirm('Delete this saved suggestion?')) return;
    try {
      await api.delete(`/ai/promo-suggestions/${id}`);
      setSavedList(prev => prev.filter(s => s.id !== id));
    } catch {}
  };

  const loadSuggestionAsCurrent = (full) => {
    if (full?.suggestions) {
      setSuggestions(full.suggestions);
      writeCache(full.suggestions);
      setViewingSaved(null);
      setViewingSavedData(null);
      setAppliedItems(new Set());
      setAppliedVouchers(new Set());
    }
  };

  const savedTotalPages = Math.max(1, Math.ceil(savedList.length / PAGE_SIZE));
  const savedPaged = savedList.slice((savedPage - 1) * PAGE_SIZE, savedPage * PAGE_SIZE);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl">
      <div>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Promotions</h2>
        <p className="text-sm text-gray-500 font-medium mt-1">Manage promo codes, item sales, and get AI-powered suggestions.</p>
      </div>

      {/* AI Promo Advisor */}
      <div className="bg-gradient-to-br from-[#bf4a53] to-red-600 rounded-3xl p-5 md:p-8 text-white shadow-lg shadow-[#bf4a53]/20">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
              <Sparkles size={20} />
            </span>
            <div>
              <h3 className="font-bold text-base">AI Promotion Advisor</h3>
              <p className="text-white/70 text-xs mt-0.5">Inventory performance + seasonal trends + revenue analysis</p>
            </div>
          </div>
          <button
            onClick={fetchSuggestions}
            disabled={loading}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold bg-white/20 hover:bg-white/30 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {loading ? 'Analyzing…' : suggestions ? 'Refresh' : 'Get Suggestions'}
          </button>
        </div>

        {/* Seasonal context pills */}
        {seasonalTips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
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
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {suggestions && (
          <div className="mt-6 space-y-5">
            {suggestions.itemSuggestions?.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Tag size={14} className="text-white/70" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white/70">Item Sale Suggestions</h4>
                  <span className="text-[10px] bg-white/15 px-2 py-0.5 rounded-full">{suggestions.itemSuggestions.length}</span>
                </div>
                <div className="space-y-2">
                  {suggestions.itemSuggestions.map((s, i) => {
                    const isApplied = appliedItems.has(s.itemId || s.itemName);
                    return (
                      <div key={i} className="bg-white/10 rounded-2xl p-4 backdrop-blur-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold">{s.itemName}</p>
                              <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">{s.discountPct}% off</span>
                              {s.suggestedExpiryDays && (
                                <span className="text-[10px] text-white/40 flex items-center gap-1">
                                  <Clock size={9} /> {s.suggestedExpiryDays}d
                                </span>
                              )}
                            </div>
                            <p className="text-white/60 text-xs mt-1">{s.rationale}</p>
                          </div>
                          <button
                            onClick={() => handleApplyToItem(s)}
                            disabled={isApplied}
                            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                              isApplied ? 'bg-white/10 text-white/40 cursor-default' : 'bg-white text-[#bf4a53] hover:bg-white/90'
                            }`}
                          >
                            {isApplied ? 'Applied' : 'Apply'}
                            {!isApplied && <ArrowRight size={11} />}
                          </button>
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
                  <Percent size={14} className="text-white/70" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white/70">Voucher Code Suggestions</h4>
                  <span className="text-[10px] bg-white/15 px-2 py-0.5 rounded-full">{suggestions.voucherSuggestions.length}</span>
                </div>
                <div className="space-y-2">
                  {suggestions.voucherSuggestions.map((s, i) => {
                    const isApplied = appliedVouchers.has(s.code);
                    return (
                      <div key={i} className="bg-white/10 rounded-2xl p-4 backdrop-blur-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold font-mono">{s.code}</p>
                              <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">{s.discountPct}% off</span>
                              {s.maxUses && <span className="text-[10px] text-white/50">max {s.maxUses}</span>}
                              {s.expiresInDays && (
                                <span className="text-[10px] text-white/40 flex items-center gap-1">
                                  <Clock size={9} /> {s.expiresInDays}d
                                </span>
                              )}
                            </div>
                            <p className="text-white/60 text-xs mt-1">{s.rationale}</p>
                          </div>
                          <button
                            onClick={() => handleCreateCode(s)}
                            disabled={isApplied}
                            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                              isApplied ? 'bg-white/10 text-white/40 cursor-default' : 'bg-white text-[#bf4a53] hover:bg-white/90'
                            }`}
                          >
                            {isApplied ? 'Created' : 'Create Code'}
                            {!isApplied && <ArrowRight size={11} />}
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
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 text-base">Saved Suggestions</h3>
            <p className="text-xs text-gray-500 mt-0.5">Previously generated AI suggestions — view or reapply</p>
          </div>
        </div>

        {savedLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-50 rounded-2xl shimmer" />)}
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
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{meta.excerpt}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(meta.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {meta.uploaded && <span className="ml-2 text-emerald-500">cloud</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => viewSavedSuggestion(meta)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors" title="View">
                      <Eye size={15} />
                    </button>
                    <button onClick={() => deleteSavedSuggestion(meta.id)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors" title="Delete">
                      <Trash2 size={15} />
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
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => { setViewingSaved(null); setViewingSavedData(null); }} />
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
                  <button onClick={() => loadSuggestionAsCurrent(viewingSavedData)}
                    className="text-xs font-bold text-[#bf4a53] bg-rose-50 px-3 py-1.5 rounded-full hover:bg-rose-100 transition-colors">
                    Load as Current
                  </button>
                  <button onClick={() => { setViewingSaved(null); setViewingSavedData(null); }}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"><X size={16} /></button>
                </div>
              </div>
              <div className="overflow-y-auto px-5 sm:px-6 pb-6 pt-4 space-y-5 min-h-0">
              {viewingLoading ? (
                <div className="space-y-3">
                  {[1,2].map(i => <div key={i} className="h-24 bg-gray-50 rounded-2xl shimmer" />)}
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
                <p className="text-sm text-gray-400 text-center py-4">Failed to load suggestion details.</p>
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
