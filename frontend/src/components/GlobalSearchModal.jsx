import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, ShoppingBag, Clock, User, ArrowRight } from 'lucide-react';
import ItemImage from './ItemImage';
import { customerLabel, itemLabel } from '../utils/format';
import { itemPill, txPill } from '../utils/statusColors';

export default function GlobalSearchModal({ transactions, inventory, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const results = useMemo(() => {
    if (!query.trim()) return { customers: [], items: [], transactions: [] };
    const q = query.toLowerCase();
    const seenCustomers = new Set();
    const customers = [];
    const txs = [];
    const items = inventory.filter(i =>
      i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q)
    ).slice(0, 6);
    for (const tx of transactions) {
      if (txs.length < 6 && (tx.customer || '').toLowerCase().includes(q)) {
        txs.push(tx);
      }
      if (customers.length < 6 && tx.customer && !seenCustomers.has(tx.customer) && tx.customer.toLowerCase().includes(q)) {
        seenCustomers.add(tx.customer);
        customers.push({ name: tx.customer, contact: tx.contact || '' });
      }
    }
    return { customers, items, transactions: txs };
  }, [query, transactions, inventory]);

  const hasResults = results.customers.length > 0 || results.items.length > 0 || results.transactions.length > 0;

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh] p-4 bg-gray-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-5 border-b border-gray-100/80">
          <Search size={18} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search customers, items, transactions..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 text-sm font-medium outline-none bg-transparent placeholder:text-gray-300"
          />
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {!query.trim() && (
            <p className="text-xs text-gray-400 text-center py-8 font-medium">
              Start typing to search customers, inventory items, or transactions
            </p>
          )}

          {query.trim() && !hasResults && (
            <p className="text-xs text-gray-400 text-center py-8 font-medium">
              No results found for "{query}"
            </p>
          )}

          {results.customers.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-3 py-2">Customers</p>
              {results.customers.map((c, i) => (
                <button key={i}
                  onClick={() => { onNavigate('History'); }}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                    <User size={16} className="text-[#bf4a53]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{c.name}</p>
                    {c.contact && <p className="text-xs text-gray-500">{c.contact}</p>}
                  </div>
                  <ArrowRight size={14} className="text-gray-300" />
                </button>
              ))}
            </div>
          )}

          {results.items.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-3 py-2">Inventory</p>
              {results.items.map(item => (
                <button key={item.id}
                  onClick={() => onNavigate('Catalog')}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 overflow-hidden">
                    <ItemImage thumb image={item.image} alt="" className="w-full h-full object-cover" placeholderSize={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                    <p className="text-xs text-gray-500">₱{item.price?.toLocaleString()} · {item.status}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${itemPill(item.status).bg} ${itemPill(item.status).text}`}>
                    {item.status}
                  </span>
                </button>
              ))}
            </div>
          )}

          {results.transactions.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-3 py-2">Transactions</p>
              {results.transactions.map(tx => (
                <button key={tx.id}
                  onClick={() => onNavigate('History')}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center shrink-0">
                    <Clock size={16} className="text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{itemLabel(tx.item)}</p>
                    <p className="text-xs text-gray-500">{customerLabel(tx.customer)} · {tx.date}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${txPill(tx.status).bg} ${txPill(tx.status).text}`}>
                    {tx.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-100/50 flex items-center justify-between px-5">
          <p className="text-[10px] text-gray-400 font-medium">
            {hasResults ? `${results.customers.length + results.items.length + results.transactions.length} result(s)` : ''}
          </p>
          <p className="text-[10px] text-gray-300 font-medium">
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[9px]">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}
