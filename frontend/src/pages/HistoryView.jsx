import { useState } from 'react';
import { Undo2, Search, X, SlidersHorizontal, RotateCcw, ChevronLeft, ChevronRight, Trash2, Eye, XCircle, Download, Calendar, Package, Pencil, MessageCircle, Phone } from 'lucide-react';
import TransactionDetailModal from '../components/TransactionDetailModal';
import CancelBookingModal from '../components/CancelBookingModal';
import { customerService } from '../services/customer';
import DateRangePicker, { formatDateRangeLabel } from '../components/DateRangePicker';
import ReleaseItemModal from '../components/ReleaseItemModal';
import EditRentalModal from '../components/EditRentalModal';
import { Skeleton } from '../components/Skeleton';
import { api } from '../utils/api';
import { customerLabel, customerTelLink, itemLabel } from '../utils/format';
import { isReleased, getReleasePhoto } from '../hooks/useTransactions';
import ItemImage from '../components/ItemImage';
import { TX_STATUS_PILLS } from '../utils/statusColors';

const formatDate = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }); }
  catch { return d; }
};

const formatCurrency = (n) => {
  if (n == null) return '₱0';
  try { return `₱${Number(n).toLocaleString()}`; }
  catch { return `₱${n}`; }
};

const statusColors = Object.fromEntries(
  Object.entries(TX_STATUS_PILLS).map(([k, v]) => [k, `${v.bg} ${v.text}`])
);

const ALL_STATUSES = ['All', 'Active', 'Overdue', 'Returned', 'Cancelled', 'Reserved', 'Released'];  // Released = Active/Overdue with conditionPhoto

// Date filter: the heavy lifting (two-month popover, presets, hover-range
// highlight, single-tap vs range, future-date support) lives in
// `components/DateRangePicker.jsx`. This page only deals in [from, to]
// strings and a single popover-open flag.

export default function HistoryView({ role, transactions, inventory, onReturn, onDelete, onCancel, onRelease, fetchFull, loading, onNavigateDetail }) {
  const isStaff = role !== 'Customer';
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [activeStatusFilter, setActiveStatusFilter] = useState('All');

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [detailTx, setDetailTx] = useState(null);
  const [cancelTx, setCancelTx] = useState(null);
  const [releaseTx, setReleaseTx] = useState(null);
  const [editRental, setEditRental] = useState(null);       // tx staff is editing (booking dates/notes + customer)
  const [smsModalTx, setSmsModalTx] = useState(null);
  const [sendingSms, setSendingSms] = useState(false);
  const itemsPerPage = 10;

  // Rows navigate to a real URL when the app provides a router callback;
  // otherwise fall back to the local modal (e.g. standalone usage).
  const openDetail = (tx) => {
    if (onNavigateDetail) onNavigateDetail(tx);
    else setDetailTx(tx);
  };

  const activeFilterCount = (activeStatusFilter !== 'All' ? 1 : 0)
    + ((dateFrom !== '' || dateTo !== '') ? 1 : 0);

  const clearFilters = () => {
    setActiveStatusFilter('All');

    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  const applyDateRange = ({ from, to }) => {
    setDateFrom(from);
    setDateTo(to);
    setCurrentPage(1);
  };

  const handleContactAdmin = (payload) => customerService.contactAdmin(payload);

  const handleSendSMS = async (tx) => {
    setSendingSms(true);
    try {
      await api.post('/sms/send', {
        profileId: tx.customerId,
        transactionId: tx.id,
        message: `Hi ${customerLabel(tx.customer)}, your rental of ${itemLabel(tx.item)} is now overdue. Please return immediately to minimize penalties. Thank you!`,
      });
      setSendingSms(false);
      setSmsModalTx(null);
      alert('SMS sent successfully.');
    } catch (err) {
      setSendingSms(false);
      alert(err?.message || 'Failed to send SMS.');
    }
  };

  const statusPriority = { Active: 0, Overdue: 1, Reserved: 2, Returned: 3, Cancelled: 4 };

  const filteredTransactions = transactions
    .filter((tx) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (tx.id || '').toLowerCase().includes(q) ||
        (customerLabel(tx.customer) || '').toLowerCase().includes(q) ||
        (itemLabel(tx.item) || '').toLowerCase().includes(q)
      );
    })
    .filter((tx) => {
      if (activeStatusFilter !== 'All') {
        if (activeStatusFilter === 'Released') return isReleased(tx);
        return tx.status === activeStatusFilter;
      }
      return true;
    })
    .filter((tx) => {
      if (dateFrom) {
        const txDate = new Date(tx.date || tx.rentalDate);
        if (txDate < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        const txDate = new Date(tx.date || tx.rentalDate);
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        if (txDate > endDate) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const pa = statusPriority[a.status] ?? 99;
      const pb = statusPriority[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.date || b.rentalDate || 0) - new Date(a.date || a.rentalDate || 0);
    });

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  const safePage = Math.min(currentPage, Math.max(totalPages, 1));
  const startIdx = (safePage - 1) * itemsPerPage;
  const displayedTransactions = filteredTransactions.slice(startIdx, startIdx + itemsPerPage);

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };
  const clearSearch = () => {
    setSearchQuery('');
    setCurrentPage(1);
  };

  const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

  return (
    <>
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">
            {role === 'Customer' ? 'Transactions' : 'Records'}
          </h2>
          <p className="text-gray-500 font-medium mt-1">
            {role === 'Customer'
              ? 'Track your active and past reservations.'
              : 'Digital logbook of all rental transactions.'}
          </p>
        </div>

        {/* Search + Filter toggle row */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search by ID, customer, or item..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-9 pr-9 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 transition-colors"
            />
            {searchQuery && (
              <button onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5">
                <X size={15} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5 self-end sm:self-auto">
            <button onClick={() => setShowFilters(!showFilters)}
              className={`relative flex items-center justify-center w-9 h-9 rounded-lg border transition-colors shrink-0 ${
                showFilters || activeFilterCount > 0
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
              }`}>
              <SlidersHorizontal size={16} />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#bf4a53] text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {activeFilterCount}
                </span>
              )}
            </button>

            <div className="text-xs text-gray-500 whitespace-nowrap tabular-nums">
              <span className="font-semibold text-gray-900">{filteredTransactions.length}</span><span className="text-gray-400">/{transactions.length}</span>
            </div>

            {isStaff && (
<button onClick={() => api.download('/export/transactions', 'transactions.xlsx')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors shrink-0">
                <Download size={14} /> Excel
              </button>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Status pills */}
            <div className="px-4 py-3 border-b border-gray-50">
              <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
                {ALL_STATUSES.map(s => {
                  const active = activeStatusFilter === s;
                  const count = s !== 'All'
                    ? s === 'Released'
                      ? transactions.filter(isReleased).length
                      : transactions.filter(tx => tx.status === s).length
                    : '';
                  return (
                    <button key={s} onClick={() => { setActiveStatusFilter(s); setCurrentPage(1); }}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                        active
                          ? 'bg-gray-900 text-white shadow-sm'
                          : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 border border-gray-200/50'
                      }`}>
                      {s === 'All' ? 'All' : s}{count ? ` ${count}` : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date row — the trigger pill doubles as the visible selection
                summary; clicking opens a two-month calendar popover (portal
                to <body>, so the panel's `overflow-hidden` can't clip it). */}
            {isStaff && (
              <div className="px-4 py-3 border-b border-gray-50">
                <DateRangePicker
                  from={dateFrom}
                  to={dateTo}
                  onChange={applyDateRange}
                />
              </div>
            )}

            {/* Active filter chips + Clear all */}
            {activeFilterCount > 0 && (
              <div className="px-4 py-2 bg-gray-50/80 border-t border-gray-50 flex items-center gap-2 overflow-x-auto hide-scrollbar">
                {activeStatusFilter !== 'All' && (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                    {activeStatusFilter}
                    <button onClick={() => { setActiveStatusFilter('All'); setCurrentPage(1); }} className="text-gray-400 hover:text-gray-600 ml-0.5">
                      <X size={11} />
                    </button>
                  </span>
                )}
                {(dateFrom || dateTo) && (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                    <Calendar size={11} className="text-gray-400" />
                    {formatDateRangeLabel(dateFrom, dateTo)}
                    <button onClick={() => { setDateFrom(''); setDateTo(''); setCurrentPage(1); }} className="text-gray-400 hover:text-gray-600 ml-0.5">
                      <X size={11} />
                    </button>
                  </span>
                )}
                <button onClick={clearFilters}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-gray-400 hover:text-[#bf4a53] transition-colors ml-auto">
                  <RotateCcw size={11} />
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}

        {/* DESKTOP TABLE — only on large (lg+) screens where the columns have room. */}
        <div className="hidden lg:block bg-white border border-gray-100/80 shadow-sm rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50/50 border-b border-gray-100/80 text-gray-500 font-semibold">
                <tr>
                  <th className="px-6 py-5">ID</th>
                  {role !== 'Customer' && <th className="px-6 py-5">Customer</th>}
                  <th className="px-6 py-5">Item</th>
                  <th className="px-6 py-5 w-16">Photo</th>
                  <th className="px-6 py-5">Date</th>
                  <th className="px-6 py-5">Status</th>
                  <th className="px-6 py-5 text-right">Amount</th>
                  <th className="px-6 py-5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100/50">
                {loading && transactions.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><Skeleton className="h-3 w-12" /></td>
                      {role !== 'Customer' && <td className="px-6 py-4"><Skeleton className="h-3 w-24" /></td>}
                      <td className="px-6 py-4"><Skeleton className="h-3 w-32" /></td>
                      <td className="px-6 py-4"><Skeleton className="w-10 h-10 rounded-lg" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-3 w-20" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-16 rounded-full" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-3 w-16 ml-auto" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-6 w-6 rounded mx-auto" /></td>
                    </tr>
                  ))
                ) : displayedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={role !== 'Customer' ? 8 : 7} className="px-6 py-12 text-center text-gray-400">
                      No transactions match your search/filters.
                    </td>
                  </tr>
                ) : (
                  displayedTransactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="hover:bg-gray-50/50 transition-colors group cursor-pointer"
                      onClick={() => openDetail(tx)}
                    >
                      <td className="px-6 py-4 font-bold text-gray-900 font-mono text-xs">
{String(tx.txNumber ?? tx.id ?? '').slice(0, 8)}
                      </td>
                      {role !== 'Customer' && (
                        <td className="px-6 py-4 text-gray-700 font-medium">{customerLabel(tx.customer) || '—'}</td>
                      )}
                      <td className="px-6 py-4 text-gray-500">{tx.item || '—'}</td>
                      <td className="px-6 py-4">
                        {getReleasePhoto(tx) ? (
                          <ItemImage image={getReleasePhoto(tx)} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-100" />
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-[13px]">{formatDate(tx.rentalDate || tx.date)}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide whitespace-nowrap ${statusColors[tx.status] || 'bg-gray-100 text-gray-600'}`}>
                          {tx.status || '—'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold text-gray-900 text-right">
                        {formatCurrency(tx.rentalFee ?? tx.amount)}
                      </td>
                      <td className="px-6 py-4 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => openDetail(tx)}
                            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                            title="View Details"
                          >
                            <Eye size={15} />
                          </button>
                          {(tx.status === 'Active' || tx.status === 'Reserved') && !isReleased(tx) && role !== 'Customer' && (
                            <button
                              onClick={() => setReleaseTx(tx)}
                              className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-600 hover:text-white rounded-full transition-colors"
                              title="Release Item"
                            >
                              <Package size={15} />
                              <span className="sr-only">Release Item</span>
                            </button>
                          )}
                          {tx.status === 'Overdue' && role !== 'Customer' && customerTelLink(tx.customerProfile || tx.customer, tx.contact || tx.customerPhone) && (
                            <a
                              href={customerTelLink(tx.customerProfile || tx.customer, tx.contact || tx.customerPhone)}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors"
                              title="Call Customer"
                            >
                              <Phone size={15} />
                              <span className="sr-only">Call Customer</span>
                            </a>
                          )}
                          {tx.status === 'Overdue' && role !== 'Customer' && (
                            <button
                              onClick={() => setSmsModalTx(tx)}
                              className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                              title="Send SMS"
                            >
                              <MessageCircle size={15} />
                              <span className="sr-only">Send SMS</span>
                            </button>
                          )}
                          {role !== 'Customer' && (tx.status === 'Overdue' || (tx.status === 'Active' && isReleased(tx))) && (
                            <button
                              onClick={() => onReturn(tx)}
                              className="p-1.5 text-[#bf4a53] bg-red-50 hover:bg-[#bf4a53] hover:text-white rounded-full transition-colors"
                              title="Process Return"
                            >
                              <Undo2 size={16} />
                              <span className="sr-only">Process Return</span>
                            </button>
                          )}
                          {(role === 'Admin' || role === 'Staff') && (
                            <button
                              onClick={() => setEditRental(tx)}
                              className="p-1.5 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
                              title="Edit rental"
                              aria-label={`Edit rental ${tx.txNumber ?? tx.id}`}
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                          {(role === 'Admin' || role === 'Staff') && ['Active', 'Reserved', 'Overdue'].includes(tx.status) && (
                            <button
                              onClick={() => setCancelTx(tx)}
                              className="p-1.5 text-red-500 bg-red-50 hover:bg-red-100 rounded-full transition-colors"
                              title="Cancel Booking"
                              aria-label={`Cancel booking ${tx.txNumber ?? tx.id}`}
                            >
                              <XCircle size={15} />
                              <span className="sr-only">Cancel Booking</span>
                            </button>
                          )}
                          {(tx.status === 'Active') && role === 'Customer' && (
                            <button
                              onClick={() => setCancelTx(tx)}
                              className="p-1.5 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-full transition-colors"
                              title="Cancel Booking"
                            >
                              <XCircle size={15} />
                              <span className="sr-only">Cancel Booking</span>
                            </button>
                          )}
                          {role === 'Admin' && (
                            <button
                              onClick={() => {
                                if (window.confirm(`Delete transaction ${tx.id}? This cannot be undone.`)) {
                                  onDelete(tx.id);
                                }
                              }}
                              className="p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-full transition-colors"
                              title="Delete Transaction"
                            >
                              <Trash2 size={14} />
                              <span className="sr-only">Delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                Showing {startIdx + 1}-{Math.min(startIdx + itemsPerPage, filteredTransactions.length)} of {filteredTransactions.length}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePrevPage}
                  disabled={safePage === 1}
                  className={`p-1.5 rounded-full ${safePage === 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-xs font-semibold text-gray-700">{safePage} / {totalPages}</span>
                <button
                  onClick={handleNextPage}
                  disabled={safePage === totalPages}
                  className={`p-1.5 rounded-full ${safePage === totalPages ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* MOBILE / TABLET CARD VIEW — used on small and medium screens for all
            roles so the dense table doesn't overlap. Fields reduced: shows only
            customer (staff only), item, date, status + actions (photo is omitted
            to keep the cards compact). */}
        <div className="lg:hidden space-y-3">
          {displayedTransactions.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-6 text-center text-gray-500">
              No transactions match your search/filters.
            </div>
          ) : (
            displayedTransactions.map((tx) => (
              <div
                key={tx.id}
                className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-4 space-y-2.5 cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => openDetail(tx)}
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-mono font-bold text-gray-900">
                      #{String(tx.txNumber ?? tx.id ?? '').slice(0, 8)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDate(tx.rentalDate || tx.date)}</p>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide whitespace-nowrap ${statusColors[tx.status] || 'bg-gray-100 text-gray-600'}`}>
                    {tx.status || '—'}
                  </span>
                </div>

                {role !== 'Customer' && (
                  <p className="text-sm text-gray-700 min-w-0">
                    <span className="text-gray-400 text-xs">Customer:</span>{' '}
                    <span className="font-medium break-words">{customerLabel(tx.customer) || '—'}</span>
                  </p>
                )}

                <p className="text-sm text-gray-700 min-w-0">
                  <span className="text-gray-400 text-xs">Item:</span>{' '}
                  <span className="font-medium break-words">{tx.item || '—'}</span>
                </p>

                <div className="flex justify-between items-center pt-2 border-t border-gray-100/60">
                  <p className="text-sm font-bold text-gray-900">
                    {formatCurrency(tx.rentalFee ?? tx.amount)}
                  </p>
                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => openDetail(tx)}
                      className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                      title="View Details"
                    >
                      <Eye size={16} />
                    </button>
                    {(tx.status === 'Active' || tx.status === 'Reserved') && !isReleased(tx) && role !== 'Customer' && (
                      <button
                        onClick={() => setReleaseTx(tx)}
                        className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-600 hover:text-white rounded-full transition-colors"
                        title="Release Item"
                      >
                        <Package size={16} />
                      </button>
                    )}
                    {tx.status === 'Overdue' && role !== 'Customer' && customerTelLink(tx.customerProfile || tx.customer, tx.contact || tx.customerPhone) && (
                      <a
                        href={customerTelLink(tx.customerProfile || tx.customer, tx.contact || tx.customerPhone)}
                        className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors"
                        title="Call Customer"
                      >
                        <Phone size={16} />
                      </a>
                    )}
                    {tx.status === 'Overdue' && role !== 'Customer' && (
                      <button
                        onClick={() => setSmsModalTx(tx)}
                        className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                        title="Send SMS"
                      >
                        <MessageCircle size={16} />
                      </button>
                    )}
                    {role !== 'Customer' && (tx.status === 'Overdue' || (tx.status === 'Active' && isReleased(tx))) && (
                      <button
                        onClick={() => onReturn(tx)}
                        className="p-2 text-[#bf4a53] bg-red-50 hover:bg-[#bf4a53] hover:text-white rounded-full transition-colors"
                        title="Process Return"
                      >
                        <Undo2 size={16} />
                      </button>
                    )}
                    {/* Edit rental — mirror of the desktop-table action; opens the
                        same EditRentalModal so dates/notes/customer edits work on
                        mobile/iPad too. */}
                    {(role === 'Admin' || role === 'Staff') && (
                      <button
                        onClick={() => setEditRental(tx)}
                        className="p-2 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
                        title="Edit rental"
                        aria-label={`Edit rental ${tx.txNumber ?? tx.id}`}
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                    {(role === 'Admin' || role === 'Staff') && ['Active', 'Reserved', 'Overdue'].includes(tx.status) && (
                      <button
                        onClick={() => setCancelTx(tx)}
                        className="p-2 text-red-500 bg-red-50 hover:bg-red-100 rounded-full transition-colors"
                        title="Cancel Booking"
                      >
                        <XCircle size={16} />
                      </button>
                    )}
                    {(tx.status === 'Active') && role === 'Customer' && (
                      <button
                        onClick={() => setCancelTx(tx)}
                        className="p-2 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-full transition-colors"
                        title="Cancel Booking"
                      >
                        <XCircle size={16} />
                      </button>
                    )}
                    {role === 'Admin' && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete transaction ${tx.id}? This cannot be undone.`)) {
                            onDelete(tx.id);
                          }
                        }}
                        className="p-2 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-full transition-colors"
                        title="Delete Transaction"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-500">
                Page {safePage} of {totalPages}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePrevPage}
                  disabled={safePage === 1}
                  className={`p-1.5 rounded-full ${safePage === 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={safePage === totalPages}
                  className={`p-1.5 rounded-full ${safePage === totalPages ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transaction Detail Modal */}
      {detailTx && (
        <TransactionDetailModal
          transaction={detailTx}
          role={role}
          onClose={() => setDetailTx(null)}
          fetchFull={fetchFull}
        />
      )}

      {/* SMS Confirmation Modal */}
      {smsModalTx && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={() => setSmsModalTx(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-gray-100/80">
              <div>
                <h3 className="font-bold text-lg text-gray-900">Confirm SMS</h3>
                <p className="text-xs text-gray-500 font-medium mt-1">Send overdue reminder to customer?</p>
              </div>
              <button onClick={() => setSmsModalTx(null)}
                className="text-gray-400 hover:bg-gray-200 p-2 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-2xl p-4 text-sm">
                <p><span className="text-gray-500">Customer:</span> <strong className="text-gray-900">{customerLabel(smsModalTx.customer)}</strong></p>
                <p className="mt-1"><span className="text-gray-500">Item:</span> <strong className="text-gray-900">{itemLabel(smsModalTx.item)}</strong></p>
                <p className="mt-1"><span className="text-gray-500">Due Date:</span> <strong className="text-red-500">{smsModalTx.dueDate || smsModalTx.date}</strong></p>
              </div>
              <p className="text-xs text-gray-500 text-center">The SMS will say: "Please return your rented item immediately."</p>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setSmsModalTx(null)}
                  className="flex-1 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-full transition-colors">Cancel</button>
                <button onClick={() => handleSendSMS(smsModalTx)} disabled={sendingSms}
                  className="flex-1 py-2.5 text-sm font-bold text-white bg-[#bf4a53] hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors shadow-sm shadow-red-500/20">
                  {sendingSms ? 'Sending...' : 'Send SMS'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Booking Modal (proper dialog + message-the-boutique) */}
      {cancelTx && (
        <CancelBookingModal
          tx={cancelTx}
          role={role}
          onClose={() => setCancelTx(null)}
          onCancel={onCancel}
          onSendMessage={handleContactAdmin}
        />
      )}

      {releaseTx && (
        <ReleaseItemModal transaction={releaseTx} onClose={() => setReleaseTx(null)} onReleased={(updated) => { onRelease(updated); setReleaseTx(null); }} />
      )}

      {editRental && (
        <EditRentalModal
          transaction={editRental}
          onClose={() => setEditRental(null)}
          onSaved={() => setEditRental(null)}
        />
      )}
    </>
  );
}

