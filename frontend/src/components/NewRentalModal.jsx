import { useState } from 'react';
import { X, Plus } from 'lucide-react';

export default function NewRentalModal({ onClose, onAdd, inventory }) {
  const [customer, setCustomer] = useState('');
  const [item, setItem] = useState(inventory[0].name);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  const today = new Date().toISOString().split('T')[0];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!customer || !item || !date || !amount) return;

    const newTx = {
      id: `TX-${Math.floor(1000 + Math.random() * 9000)}`,
      customer,
      item,
      date: new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }),
      status: 'Active',
      amount: parseFloat(amount),
      conditionPhoto: photoUrl, // mock pre‑rental condition image
    };
    onAdd(newTx);
  };

  return (
    <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-300" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-6 border-b border-gray-100/80">
          <h3 className="font-bold text-xl text-gray-900">New Rental</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                Customer Name
              </label>
              <input
                type="text"
                required
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all"
                placeholder="e.g. Maria Clara"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                Contact Number
              </label>
              <input
                type="tel"
                required
                className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all"
                placeholder="09XX XXX XXXX"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
              Select Garment
            </label>
            <select
              value={item}
              onChange={(e) => setItem(e.target.value)}
              className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all cursor-pointer"
            >
              {inventory.map((ci) => (
                <option key={ci.id} value={ci.name}>
                  {ci.name} - ₱{ci.price.toLocaleString()} ({ci.status})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                Pickup Date
              </label>
              <input
                type="date"
                required
                min={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                Payment Amount (₱)
              </label>
              <input
                type="number"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-all"
                placeholder="e.g. 1500"
              />
            </div>
          </div>

          {/* Mock Condition Photo */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
              Condition Photo URL (Mock)
            </label>
            <input
              type="url"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 transition-all"
              placeholder="https://... (optional pre‑rental image)"
            />
          </div>

          <div className="pt-6 flex items-center justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 text-[13px] font-bold text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 text-[13px] font-bold text-white bg-gray-900 hover:bg-gray-800 rounded-full shadow-sm shadow-gray-900/20 transition-all flex items-center gap-2"
            >
              <Plus size={16} strokeWidth={3} /> Process
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}