import { useState, useEffect } from 'react';
import { X, Receipt, User, Shirt, Calendar, Ruler, FileText, CreditCard, Camera, Download, Banknote, Smartphone } from 'lucide-react';
import { customerLabel, customerPhone, itemLabel } from '../utils/format';
import { normalizeTx } from '../hooks/useTransactions';
import { getBookingCode } from '../utils/receipt';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import ItemImage from './ItemImage';
import BookingQR from './BookingQR';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { TX_STATUS_PILLS } from '../utils/statusColors';
import { api } from '../utils/api';

const fmtDate = (d) => {
  if (!d) return null;
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });
  } catch { return d; }
};

const fmtCurrency = (n) => {
  if (n == null || n === '') return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return `₱${num.toLocaleString()}`;
};

const statusColors = Object.fromEntries(
  Object.entries(TX_STATUS_PILLS).map(([k, v]) => [k, `${v.bg} ${v.text} ${v.ring}`])
);

function DetailRow({ label, value, highlight }) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div className="flex justify-between items-start py-2.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm text-right max-w-[55%] break-words ${highlight ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`}>{value}</span>
    </div>
  );
}

export default function TransactionDetailModal({ transaction, onClose, fetchFull, role }) {
  useEscapeClose(onClose);
  const flags = useFeatureFlags();
  const [qrSaveUrl, setQrSaveUrl] = useState(null);
  const [tx, setTx] = useState(transaction);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);

  // Fetch enrichment only when the transaction id changes — `transaction` is a
  // new object identity on every parent render, and `normalizeTx()` also
  // returns a fresh object, so depending on them (or calling setTx every
  // render + every fetch resolve) creates an infinite update loop, which is
  // what used to block the close button from ever un-mounting the modal.
  useEffect(() => {
    setTx(transaction);
  }, [transaction?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (transaction?.id && fetchFull) {
      let cancelled = false;
      // normalize the full record so customerProfile is always present —
      // otherwise the address flickers in from the list item then vanishes.
      fetchFull(transaction.id)
        .then((full) => { if (!cancelled) setTx(normalizeTx(full)); })
        .catch(() => {});
      return () => { cancelled = true; };
    }
  }, [transaction?.id, fetchFull]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tx) return null;

  const status = tx.status;
  const statusColor = statusColors[status] || 'bg-gray-100 text-gray-600 ring-gray-200';
  const txRef = `#${String(tx.txNumber ?? tx.id ?? '').slice(0, 8)}`;
  const outstandingBalance = Math.max(0, tx.balance ?? 0);
  const canRecordPayment = (role === 'Admin' || role === 'Staff')
    && !['Returned', 'Cancelled'].includes(tx.status)
    && outstandingBalance > 0;

  const handleRecordPayment = async () => {
    setPayError('');
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { setPayError('Enter a valid amount'); return; }
    if (amt > outstandingBalance) { setPayError(`Maximum is ₱${outstandingBalance.toLocaleString()}`); return; }
    setPayLoading(true);
    try {
      const res = await api.post(`/transactions/${tx.id}/payments`, { amount: amt, method: payMethod, notes: payNotes || undefined });
      setTx(prev => ({
        ...prev,
        totalPaid: res.totalPaid,
        balance: res.balance,
        payments: [...(prev.payments || []), res.payment],
      }));
      setPaySuccess(true);
      setTimeout(() => { setShowPayModal(false); setPaySuccess(false); setPayAmount(''); setPayNotes(''); }, 1200);
    } catch (err) {
      setPayError(err?.message || 'Failed to record payment');
    } finally {
      setPayLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-transaction-detail" className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-gray-100/80 rounded-t-3xl z-10">
          <div className="flex items-center justify-between p-5 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gray-100 rounded-xl">
                <Receipt size={18} className="text-gray-600" />
              </div>
              <div>
                <h3 id="dialog-title-transaction-detail" className="font-bold text-lg text-gray-900">Transaction {txRef}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {status === 'Active' ? 'Currently rented' :
                   status === 'Overdue' ? 'Past due date' :
                   status === 'Returned' ? 'Completed' :
                   status === 'Reserved' ? 'Upcoming booking' : status}
                </p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close transaction details" className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
              <X size={18} />
            </button>
          </div>
          <div className="px-5 pb-4">
            <span className={`inline-block px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide ring-1 ${statusColor}`}>
              {status}
            </span>
          </div>
        </div>

        <div className="p-5 space-y-6">

          {/* Customer & Item */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-2xl p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-gray-400">
                <User size={13} />
                <span className="text-[10px] font-bold uppercase tracking-wide">Customer</span>
              </div>
              <p className="font-bold text-gray-900">{customerLabel(tx.customer) || '—'}</p>
              {customerPhone(tx.customerProfile || tx.customer, tx.contact || tx.customerPhone) && (
                <p className="text-xs text-gray-500">{customerPhone(tx.customerProfile || tx.customer, tx.contact || tx.customerPhone)}</p>
              )}
              {tx.customerProfile?.address && (
                <p className="text-xs text-gray-500">{tx.customerProfile.address}</p>
              )}
            </div>
            <div className="bg-gray-50 rounded-2xl p-4 space-y-1">
              <div className="flex items-center gap-1.5 text-gray-400">
                <Shirt size={13} />
                <span className="text-[10px] font-bold uppercase tracking-wide">Item</span>
              </div>
              <p className="font-bold text-gray-900">{itemLabel(tx.item) || '—'}</p>
              {tx.size && <p className="text-xs text-gray-500">Size: {tx.size}</p>}
            </div>
          </div>

          {/* Dates */}
          <div>
            <div className="flex items-center gap-1.5 text-gray-400 mb-3">
              <Calendar size={13} />
              <span className="text-[10px] font-bold uppercase tracking-wide">Schedule</span>
            </div>
            <div className="bg-white border border-gray-100/80 rounded-2xl p-4 divide-y divide-gray-100">
              <DetailRow label="Pickup Date" value={fmtDate(tx.rentalDate || tx.date)} />
              <DetailRow label="Event Date" value={fmtDate(tx.eventDate)} />
              <DetailRow label="Due / Return By" value={fmtDate(tx.dueDate || tx.returnDate)} />
              <DetailRow label="Actual Return" value={fmtDate(tx.returnDate)} />
            </div>
          </div>

          {/* Payment Summary */}
          <div>
            <div className="flex items-center gap-1.5 text-gray-400 mb-3">
              <CreditCard size={13} />
              <span className="text-[10px] font-bold uppercase tracking-wide">Payment</span>
            </div>
            <div className="bg-white border border-gray-100/80 rounded-2xl p-4 divide-y divide-gray-100">
              <DetailRow label="Rental Fee" value={fmtCurrency(tx.rentalFee ?? tx.amount)} />
              <DetailRow label="Downpayment" value={fmtCurrency(tx.downpayment)} />
              <DetailRow label="Balance" value={fmtCurrency(outstandingBalance)} highlight />
              {tx.latePenalty > 0 && <DetailRow label="Late Penalty" value={fmtCurrency(tx.latePenalty)} />}
              {tx.damageFee > 0 && <DetailRow label="Damage Fee" value={fmtCurrency(tx.damageFee)} />}
              {tx.totalPaid > 0 && <DetailRow label="Total Paid" value={fmtCurrency(tx.totalPaid)} />}
            </div>
            {Array.isArray(tx.payments) && tx.payments.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Payment History</p>
                {tx.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${p.method === 'cash' ? 'bg-green-100 text-green-700' : p.method === 'gcash' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {p.method === 'cash' ? <Banknote size={14} /> : p.method === 'gcash' ? <Smartphone size={14} /> : <CreditCard size={14} />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{fmtCurrency(p.amount)}</p>
                        <p className="text-[10px] text-gray-500 capitalize">{p.method} · {p.type}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400">{new Date(p.createdAt).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Booking QR */}
          {flags.qr_codes && tx.id && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Booking QR</p>
                {qrSaveUrl && (
                  <a
                    href={qrSaveUrl}
                    download={`${getBookingCode(tx)}.png`}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-[#bf4a53] hover:underline"
                    title="Download a copy of this QR code">
                    <Download size={11} /> Save QR
                  </a>
                )}
              </div>
              <div className="bg-white border border-gray-100/80 rounded-2xl p-4 flex items-center justify-center flex-col">
                <BookingQR tx={tx} size={96} showCode={false} title="Scan to open this booking" onDataUrl={setQrSaveUrl} />
              </div>
            </div>
          )}

          {/* Measurements */}
          {tx.measurements && Object.keys(tx.measurements).length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-400 mb-3">
                <Ruler size={13} />
                <span className="text-[10px] font-bold uppercase tracking-wide">Measurements</span>
              </div>
              <div className="bg-white border border-gray-100/80 rounded-2xl p-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {Object.entries(tx.measurements).map(([key, val]) => (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                      <span className="font-semibold text-gray-900">{val} cm</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <div className="flex items-center gap-1.5 text-gray-400 mb-3">
              <FileText size={13} />
              <span className="text-[10px] font-bold uppercase tracking-wide">Notes</span>
            </div>
            <div className="bg-white border border-gray-100/80 rounded-2xl p-4 text-sm">
              {tx.notes ? (
                <p className="text-gray-700 whitespace-pre-wrap">{tx.notes}</p>
              ) : (
                <p className="text-gray-400 italic">No notes</p>
              )}
              {(tx.address || tx.customerProfile?.address) && (
                <p className="text-gray-500 mt-2 pt-2 border-t border-gray-100">
                  <span className="font-medium text-gray-400">Address:</span> {tx.address || tx.customerProfile?.address}
                </p>
              )}
            </div>
          </div>

          {/* Condition Photos (before / after) */}
          {(tx.releasePhoto || tx.returnPhoto || tx.conditionPhoto) && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-400 mb-3">
                <Camera size={13} />
                <span className="text-[10px] font-bold uppercase tracking-wide">Condition Photos</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(tx.releasePhoto || tx.conditionPhoto) && (
                  <div className="bg-white border border-gray-100/80 rounded-2xl overflow-hidden">
                    <ItemImage image={tx.releasePhoto || tx.conditionPhoto} alt="Item condition at release" className="w-full h-40 object-cover" placeholderSize={20} />
                    <p className="text-[10px] text-gray-500 font-medium text-center py-2">Release (Before)</p>
                  </div>
                )}
                {tx.returnPhoto && (
                  <div className="bg-white border border-gray-100/80 rounded-2xl overflow-hidden">
                    <ItemImage image={tx.returnPhoto} alt="Item condition on return" className="w-full h-40 object-cover" placeholderSize={20} />
                    <p className="text-[10px] text-gray-500 font-medium text-center py-2">Return (After)</p>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-5 pt-0 space-y-2">
          {canRecordPayment && (
            <button onClick={() => setShowPayModal(true)} className="w-full py-3 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-[#a83d46] transition-colors shadow-sm flex items-center justify-center gap-2">
              <Banknote size={16} /> Record Payment
            </button>
          )}
          <button onClick={onClose} className="w-full py-3 rounded-full font-bold text-sm bg-gray-900 text-white hover:bg-gray-800 transition-colors shadow-sm">
            Close
          </button>
        </div>
      </div>

      {/* Record Payment Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-[310] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm" onClick={() => !payLoading && setShowPayModal(false)}>
          <div role="dialog" aria-modal="true" className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            {paySuccess ? (
              <div className="text-center py-4">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Banknote size={24} className="text-green-600" />
                </div>
                <p className="font-bold text-lg text-gray-900">Payment Recorded</p>
                <p className="text-sm text-gray-500 mt-1">₱{Number(payAmount).toLocaleString()} via {payMethod}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-lg text-gray-900">Record Payment</h4>
                  <button onClick={() => setShowPayModal(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition-colors" aria-label="Close payment form">
                    <X size={16} />
                  </button>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 text-sm">
                  <p className="text-gray-500">Outstanding balance</p>
                  <p className="font-bold text-lg text-[#bf4a53]">₱{outstandingBalance.toLocaleString()}</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">₱</span>
                    <input
                      type="number"
                      min="1"
                      max={outstandingBalance}
                      value={payAmount}
                      onChange={e => { setPayAmount(e.target.value); setPayError(''); }}
                      placeholder="0"
                      className="w-full pl-8 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Payment Method</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[{ key: 'cash', label: 'Cash' }, { key: 'gcash', label: 'GCash' }, { key: 'card', label: 'Card' }].map(m => (
                      <button
                        key={m.key}
                        onClick={() => setPayMethod(m.key)}
                        className={`py-2.5 rounded-xl text-sm font-bold border transition-colors ${payMethod === m.key ? 'bg-[#bf4a53] text-white border-[#bf4a53]' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Notes (optional)</label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={e => setPayNotes(e.target.value)}
                    placeholder="e.g. change given, reference #"
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors"
                  />
                </div>

                {payError && <p className="text-xs text-red-500 font-medium">{payError}</p>}

                <button
                  onClick={handleRecordPayment}
                  disabled={payLoading}
                  className="w-full py-3 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-[#a83d46] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {payLoading ? 'Recording...' : `Record ₱${Number(payAmount || 0).toLocaleString()}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
