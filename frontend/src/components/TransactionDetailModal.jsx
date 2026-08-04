import { useState, useEffect } from 'react';
import { X, Receipt, User, Shirt, Calendar, Ruler, FileText, CreditCard, Camera } from 'lucide-react';
import { customerLabel, customerPhone, itemLabel } from '../utils/format';
import { normalizeTx } from '../hooks/useTransactions';
import ItemImage from './ItemImage';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { TX_STATUS_PILLS } from '../utils/statusColors';

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

export default function TransactionDetailModal({ transaction, onClose, fetchFull }) {
  useEscapeClose(onClose);
  // FIX G: enrich the in-memory list object with the full server record
  // (payments[], processedBy, full customer/item) when available.
  const [tx, setTx] = useState(transaction);

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
              <DetailRow label="Balance" value={fmtCurrency(tx.balance)} highlight />
              {tx.latePenalty > 0 && <DetailRow label="Late Penalty" value={fmtCurrency(tx.latePenalty)} />}
              {tx.damageFee > 0 && <DetailRow label="Damage Fee" value={fmtCurrency(tx.damageFee)} />}
              {tx.totalPaid > 0 && <DetailRow label="Total Paid" value={fmtCurrency(tx.totalPaid)} />}
              {Array.isArray(tx.payments) && tx.payments.length > 0 && (
                <DetailRow label="Payments" value={`${tx.payments.length} recorded`} />
              )}
            </div>
          </div>

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
        <div className="p-5 pt-0">
          <button onClick={onClose} className="w-full py-3 rounded-full font-bold text-sm bg-gray-900 text-white hover:bg-gray-800 transition-colors shadow-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
