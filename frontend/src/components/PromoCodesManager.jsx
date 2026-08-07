import { useState, useEffect } from 'react';
import { Plus, Trash2, Percent, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../utils/api';
import { SkeletonList } from '../components/Skeleton';

export default function PromoCodesManager() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', discountPct: 10, maxUses: '', expiresAt: '' });
  const [msg, setMsg] = useState('');

  const fetchCodes = () => {
    api.get('/promo-codes').then(data => { if (Array.isArray(data)) setCodes(data); }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchCodes(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/promo-codes', {
        code: form.code,
        discountPct: form.discountPct,
        maxUses: form.maxUses ? parseInt(form.maxUses) : undefined,
        expiresAt: form.expiresAt || undefined,
      });
      setForm({ code: '', discountPct: 10, maxUses: '', expiresAt: '' });
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
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Discount %</label>
              <input type="number" min={1} max={100} value={form.discountPct}
                onChange={e => setForm({ ...form, discountPct: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) })}
                className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Max Uses</label>
              <input type="number" min={1} value={form.maxUses} onChange={e => setForm({ ...form, maxUses: e.target.value })}
                placeholder="Unlimited" className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Expires</label>
              <input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })}
                className="w-full p-2.5 bg-white rounded-xl border border-gray-200/80 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
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
            const expired = code.expiresAt && new Date(code.expiresAt) < new Date();
            const maxedOut = code.maxUses !== null && code.currentUses >= code.maxUses;
            const isUsable = code.isActive && !expired && !maxedOut;
            const statusText = expired ? 'Expired' : maxedOut ? 'Maxed out' : code.isActive ? 'Active' : 'Inactive';
            return (
              <div key={code.id} className={`flex items-center justify-between gap-3 p-4 rounded-2xl border ${isUsable ? 'bg-emerald-50/40 border-emerald-100' : 'bg-gray-50/70 border-gray-100'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => toggleActive(code)} className="shrink-0" title={code.isActive ? 'Deactivate code' : 'Activate code'}>
                    {code.isActive ? <CheckCircle2 size={18} className="text-emerald-500" /> : <XCircle size={18} className="text-gray-300" />}
                  </button>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 font-mono">{code.code}</p>
                    <p className="text-xs text-gray-500">
                      {code.discountPct}% off &middot; {code.currentUses}{code.maxUses !== null ? `/${code.maxUses}` : ''} used
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    expired || maxedOut ? 'bg-amber-50 text-amber-600' : isUsable ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {statusText}
                  </span>
                  <button onClick={() => handleDelete(code.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-full transition-colors">
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
