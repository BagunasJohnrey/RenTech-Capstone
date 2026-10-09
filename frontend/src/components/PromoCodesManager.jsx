import { useState, useEffect } from 'react';
import { Plus, Trash2, Percent, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../utils/api';
import { SkeletonList } from '../components/Skeleton';
import { promoDiscountLabel, promoTermsLabel } from '../utils/promoLabel';

const EMPTY_FORM = {
  code: '', discountType: 'pct', discountPct: 10, discountAmount: '',
  minSpend: '', startsAt: '', maxUsesPerCustomer: '', firstBookingOnly: false,
  appliesToCategories: '', maxUses: '', expiresAt: '',
};

export default function PromoCodesManager({ initialForm, onClearInitialForm }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [msg, setMsg] = useState('');

  // When an AI suggestion is applied, open the form pre-filled
  useEffect(() => {
    if (initialForm) {
      setForm(prev => ({
        ...prev,
        ...initialForm,
        discountType: initialForm.discountAmount != null ? 'amount' : 'pct',
      }));
      setShowForm(true);
      if (onClearInitialForm) onClearInitialForm();
    }
  }, [initialForm]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchCodes = () => {
    api.get('/promo-codes').then(data => { if (Array.isArray(data)) setCodes(data); }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchCodes(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const isAmount = form.discountType === 'amount';
      const categories = String(form.appliesToCategories || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      await api.post('/promo-codes', {
        code: form.code,
        discountPct: isAmount ? undefined : Number(form.discountPct),
        discountAmount: isAmount ? Number(form.discountAmount) : undefined,
        minSpend: form.minSpend === '' ? undefined : Number(form.minSpend),
        startsAt: form.startsAt || undefined,
        maxUsesPerCustomer: form.maxUsesPerCustomer === '' ? undefined : parseInt(form.maxUsesPerCustomer),
        firstBookingOnly: !!form.firstBookingOnly,
        appliesToCategories: categories.length ? categories : undefined,
        maxUses: form.maxUses ? parseInt(form.maxUses) : undefined,
        expiresAt: form.expiresAt || undefined,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      setMsg('Promo code created!');
      fetchCodes();
    } catch (err) { setMsg(err.message || 'Failed to create'); }
    setTimeout(() => setMsg(''), 2500);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this promo code?')) return;
    try {
      await api.delete(`/promo-codes/${id}`);
      setCodes(codes.filter(c => c.id !== id));
      setMsg('Promo code deleted.');
    } catch (err) { setMsg(err.message || 'Failed to delete'); }
    setTimeout(() => setMsg(''), 2500);
  };

  // FIX D: optimistic toggle that reverts and surfaces the error on failure.
  const toggleActive = async (code) => {
    const prev = code.isActive;
    setCodes(codes.map(c => c.id === code.id ? { ...c, isActive: !prev } : c));
    try {
      await api.put(`/promo-codes/${code.id}`, { isActive: !prev });
    } catch (err) {
      setCodes(codes.map(c => c.id === code.id ? { ...c, isActive: prev } : c));
      setMsg(err.message || 'Failed to update promo status');
      setTimeout(() => setMsg(''), 2500);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Percent size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 text-base">Promo Codes</h3>
            <p className="text-xs text-gray-500 mt-0.5">Discount codes customers can apply at checkout</p>
          </div>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className={`shrink-0 flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full transition-colors ${
            showForm ? 'bg-gray-100 text-gray-600' : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm'
          }`}>
          <Plus size={14} /> {showForm ? 'Cancel' : 'New Code'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-gray-50/70 border border-gray-100 rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Code</label>
              <input type="text" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="LOYAL10" required maxLength={20}
                className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Discount type</label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-white border border-gray-200/80 rounded-xl">
                {['pct', 'amount'].map((t) => (
                  <button key={t} type="button" onClick={() => setForm({ ...form, discountType: t })}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-colors ${form.discountType === t ? 'bg-emerald-500 text-white' : 'text-gray-400'}`}>
                    {t === 'pct' ? '% off' : '₱ off'}
                  </button>
                ))}
              </div>
            </div>
            {form.discountType === 'pct' ? (
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Discount %</label>
                <input type="number" min={1} max={100} value={form.discountPct}
                  onChange={e => setForm({ ...form, discountPct: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) })}
                  className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
              </div>
            ) : (
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Amount off (₱)</label>
                <input type="number" min={1} value={form.discountAmount}
                  onChange={e => setForm({ ...form, discountAmount: e.target.value })}
                  placeholder="200" required
                  className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
              </div>
            )}
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Min. spend (₱)</label>
              <input type="number" min={0} value={form.minSpend} onChange={e => setForm({ ...form, minSpend: e.target.value })}
                placeholder="No minimum" className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Max Uses</label>
              <input type="number" min={1} value={form.maxUses} onChange={e => setForm({ ...form, maxUses: e.target.value })}
                placeholder="Unlimited" className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Uses per customer</label>
              <input type="number" min={1} value={form.maxUsesPerCustomer} onChange={e => setForm({ ...form, maxUsesPerCustomer: e.target.value })}
                placeholder="Once (default)" className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Starts</label>
              <input type="date" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })}
                className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Expires</label>
              <input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })}
                className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Only these categories (blank = all)</label>
              <input type="text" value={form.appliesToCategories} onChange={e => setForm({ ...form, appliesToCategories: e.target.value })}
                placeholder="Gown, Debut" maxLength={120}
                className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <label className="sm:col-span-2 flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.firstBookingOnly} onChange={e => setForm({ ...form, firstBookingOnly: e.target.checked })}
                className="h-4 w-4 accent-emerald-500" />
              <span className="text-xs font-bold text-gray-600">First booking only (new customers)</span>
            </label>
          </div>
          <button type="submit" className="px-5 py-2 bg-emerald-500 text-white rounded-full text-sm font-bold hover:bg-emerald-600 transition-colors">
            Create Code
          </button>
        </form>
      )}

      {msg && <p className="text-xs text-emerald-600 font-bold">{msg}</p>}

      {loading ? (
        <SkeletonList count={3} />
      ) : codes.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No promo codes yet. Create your first one!</p>
      ) : (
        <div className="space-y-3">
          {codes.map(code => {
            const now = new Date();
            const expired = code.expiresAt && new Date(code.expiresAt) < now;
            const notStarted = code.startsAt && new Date(code.startsAt) > now;
            const maxedOut = code.maxUses !== null && code.currentUses >= code.maxUses;
            const isUsable = code.isActive && !expired && !notStarted && !maxedOut;
            const statusText = expired ? 'Expired' : notStarted ? 'Scheduled' : maxedOut ? 'Maxed out' : code.isActive ? 'Active' : 'Inactive';
            const terms = promoTermsLabel(code);
            return (
              <div key={code.id} className={`flex items-center justify-between gap-3 p-4 rounded-2xl border ${isUsable ? 'bg-emerald-50/40 border-emerald-100' : 'bg-gray-50/70 border-gray-100'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => toggleActive(code)} className="shrink-0" title={code.isActive ? 'Deactivate code' : 'Activate code'}>
                    {code.isActive ? <CheckCircle2 size={18} className="text-emerald-500" /> : <XCircle size={18} className="text-gray-300" />}
                  </button>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 font-mono">{code.code}</p>
                    <p className="text-xs text-gray-500">
                      {promoDiscountLabel(code)} &middot; {code.currentUses}{code.maxUses !== null ? `/${code.maxUses}` : ''} used
                      {(code.maxUsesPerCustomer ?? 1) > 1 && ` · ${code.maxUsesPerCustomer}x per customer`}
                      {terms && ` · ${terms}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    expired || maxedOut ? 'bg-amber-50 text-amber-600' : notStarted ? 'bg-blue-50 text-blue-600' : isUsable ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {statusText}
                  </span>
                  <button onClick={() => handleDelete(code.id)} title="Delete code (blocked when it has booking history)" className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-full transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
