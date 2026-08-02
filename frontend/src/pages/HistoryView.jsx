import { useState } from 'react';
import { Undo2, Search, X, SlidersHorizontal, RotateCcw, ChevronLeft, ChevronRight, Trash2, Eye, XCircle, Download, Calendar, Package } from 'lucide-react';
import TransactionDetailModal from '../components/TransactionDetailModal';
import ReleaseItemModal from '../components/ReleaseItemModal';
import { Skeleton } from '../components/Skeleton';
import { api } from '../utils/api';
import { customerLabel, itemLabel } from '../utils/format';

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

const statusColors = {
  Reserved: 'bg-blue-50 text-blue-600',
  Active: 'bg-emerald-50 text-emerald-600',
  Overdue: 'bg-red-50 text-red-600',
  Returned: 'bg-gray-100 text-gray-600',
  Cancelled: 'bg-gray-100 text-gray-500',
};

const ALL_STATUSES = ['All', 'Active', 'Overdue', 'Returned', 'Cancelled', 'Reserved', 'Released'];  // Released = Active/Overdue with conditionPhoto

export default function HistoryView({ role, transactions, inventory, onReturn, onDelete, onCancel, onRelease, fetchFull, loading }) {
  const isStaff = role !== 'Customer';
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [activeStatusFilter, setActiveStatusFilter] = useState('All');

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [detailTx, setDetailTx] = useState(null);
  const [releaseTx, setReleaseTx] = useState(null);
  const itemsPerPage = 10;

  const activeFilterCount = (activeStatusFilter !== 'All' ? 1 : 0)
    + (dateFrom !== '' ? 1 : 0)
    + (dateTo !== '' ? 1 : 0);

  const clearFilters = () => {
    setActiveStatusFilter('All');

    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
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
        if (activeStatusFilter === 'Released') return !!tx.conditionPhoto;
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
              <button onClick={() => api.download('/export/transactions', 'transactions.csv')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors shrink-0">
                <Download size={14} /> CSV
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
                      ? transactions.filter(tx => !!tx.conditionPhoto).length
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

            {/* Date range + Active only + Clear */}
            <div className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {isStaff && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <Calendar size={11} /> From
                      </span>
                      <input type="date" value={dateFrom}
                        onChange={e => { setDateFrom(e.target.value); setCurrentPage(1); }}
                        className="px-2.5 py-1.5 bg-gray-50 border border-gray-200/60 rounded-lg text-xs font-medium focus:outline-none focus:border-gray-400 transition-colors" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <Calendar size={11} /> To
                      </span>
                      <input type="date" value={dateTo}
                        onChange={e => { setDateTo(e.target.value); setCurrentPage(1); }}
                        className="px-2.5 py-1.5 bg-gray-50 border border-gray-200/60 rounded-lg text-xs font-medium focus:outline-none focus:border-gray-400 transition-colors" />
                    </div>
                  </>
                )}
                {activeFilterCount > 0 && (
                  <button onClick={clearFilters}
                    className="flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-[#bf4a53] transition-colors">
                    <RotateCcw size={12} />
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Active filter chips */}
            {activeFilterCount > 0 && (
              <div className="px-4 py-2 bg-gray-50/80 border-t border-gray-50 flex items-center gap-2 overflow-x-auto hide-scrollbar">
                {activeStatusFilter !== 'All' && (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                    {activeStatusFilter}
                    <button onClick={() => setActiveStatusFilter('All')} className="text-gray-400 hover:text-gray-600 ml-0.5">
                      <X size={11} />
                    </button>
                  </span>
                )}
                {dateFrom && (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                    From {new Date(dateFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    <button onClick={() => setDateFrom('')} className="text-gray-400 hover:text-gray-600 ml-0.5">
                      <X size={11} />
                    </button>
                  </span>
                )}
                {dateTo && (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-full border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                    To {new Date(dateTo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    <button onClick={() => setDateTo('')} className="text-gray-400 hover:text-gray-600 ml-0.5">
                      <X size={11} />
                    </button>
                  </span>
                )}
                {activeFilterCount > 1 && (
                  <button onClick={clearFilters} className="shrink-0 text-[10px] font-bold text-gray-400 hover:text-[#bf4a53] transition-colors ml-0.5">
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* DESKTOP TABLE */}
        <div className="hidden md:block bg-white border border-gray-100/80 shadow-sm rounded-3xl overflow-hidden">
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
                      onClick={() => setDetailTx(tx)}
                    >
                      <td className="px-6 py-4 font-bold text-gray-900 font-mono text-xs">
{String(tx.txNumber ?? tx.id ?? '').slice(0, 8)}
                      </td>
                      {role !== 'Customer' && (
                        <td className="px-6 py-4 text-gray-700 font-medium">{customerLabel(tx.customer) || '—'}</td>
                      )}
                      <td className="px-6 py-4 text-gray-500">{tx.item || '—'}</td>
                      <td className="px-6 py-4">
                        {tx.conditionPhoto ? (
                          <img src={tx.conditionPhoto} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-100" onError={e => { e.target.style.display = 'none'; }} />
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-[13px]">{formatDate(tx.rentalDate || tx.date)}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide ${statusColors[tx.status] || 'bg-gray-100 text-gray-600'}`}>
                          {tx.status || '—'}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold text-gray-900 text-right">
                        {formatCurrency(tx.rentalFee ?? tx.amount)}
                      </td>
                      <td className="px-6 py-4 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setDetailTx(tx)}
                            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                            title="View Details"
                          >
                            <Eye size={15} />
                          </button>
                          {(tx.status === 'Active' || tx.status === 'Reserved') && !tx.conditionPhoto && role !== 'Customer' && (
                            <button
                              onClick={() => setReleaseTx(tx)}
                              className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-600 hover:text-white rounded-full transition-colors"
                              title="Release Item"
                            >
                              <Package size={15} />
                              <span className="sr-only">Release Item</span>
                            </button>
                          )}
                          {(tx.status === 'Active' || tx.status === 'Overdue') && !!tx.conditionPhoto && role !== 'Customer' && inventory?.some(i => i.id === tx.itemId && i.status === 'Rented') && (
                            <button
                              onClick={() => onReturn(tx)}
                              className="p-1.5 text-[#bf4a53] bg-red-50 hover:bg-[#bf4a53] hover:text-white rounded-full transition-colors"
                              title="Process Return"
                            >
                              <Undo2 size={16} />
                              <span className="sr-only">Process Return</span>
                            </button>
                          )}
                          {(tx.status === 'Active') && role === 'Customer' && (
                            <button
                              onClick={() => {
                                if (window.confirm('Cancel this booking? This cannot be undone.')) {
                                  onCancel(tx.id);
                                }
                              }}
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

        {/* MOBILE CARD VIEW */}
        <div className="md:hidden space-y-4">
          {displayedTransactions.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-6 text-center text-gray-500">
              No transactions match your search/filters.
            </div>
          ) : (
            displayedTransactions.map((tx) => (
              <div
                key={tx.id}
                className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 space-y-3 cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => setDetailTx(tx)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-mono font-bold text-gray-900">
                      #{String(tx.txNumber ?? tx.id ?? '').slice(0, 8)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDate(tx.rentalDate || tx.date)}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide ${statusColors[tx.status] || 'bg-gray-100 text-gray-600'}`}>
                    {tx.status || '—'}
                  </span>
                </div>

                {role !== 'Customer' && (
                  <p className="text-sm text-gray-700">
                    <span className="text-gray-400 text-xs">Customer:</span>{' '}
                    <span className="font-medium">{customerLabel(tx.customer) || '—'}</span>
                  </p>
                )}

                <p className="text-sm text-gray-700">
                  <span className="text-gray-400 text-xs">Item:</span>{' '}
                  <span className="font-medium">{tx.item || '—'}</span>
                </p>

                {tx.conditionPhoto && (
                  <div>
                    <img src={tx.conditionPhoto} alt="" className="w-full h-32 rounded-xl object-cover bg-gray-100" onError={e => { e.target.style.display = 'none'; }} />
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t border-gray-100/60">
                  <p className="text-sm font-bold text-gray-900">
                    {formatCurrency(tx.rentalFee ?? tx.amount)}
                  </p>
                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setDetailTx(tx)}
                      className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                      title="View Details"
                    >
                      <Eye size={16} />
                    </button>
                    {(tx.status === 'Active' || tx.status === 'Reserved') && !tx.conditionPhoto && role !== 'Customer' && (
                      <button
                        onClick={() => setReleaseTx(tx)}
                        className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-600 hover:text-white rounded-full transition-colors"
                        title="Release Item"
                      >
                        <Package size={16} />
                      </button>
                    )}
                    {(tx.status === 'Active' || tx.status === 'Overdue') && !!tx.conditionPhoto && role !== 'Customer' && inventory?.some(i => i.id === tx.itemId && i.status === 'Rented') && (
                      <button
                        onClick={() => onReturn(tx)}
                        className="p-2 text-[#bf4a53] bg-red-50 hover:bg-[#bf4a53] hover:text-white rounded-full transition-colors"
                        title="Process Return"
                      >
                        <Undo2 size={16} />
                      </button>
                    )}
                    {(tx.status === 'Active') && role === 'Customer' && (
                      <button
                        onClick={() => {
                          if (window.confirm('Cancel this booking? This cannot be undone.')) {
                            onCancel(tx.id);
                          }
                        }}
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

      {releaseTx && (
        <ReleaseItemModal transaction={releaseTx} onClose={() => setReleaseTx(null)} onReleased={(updated) => { onRelease(updated); setReleaseTx(null); }} />
      )}
    </>
  );
}

