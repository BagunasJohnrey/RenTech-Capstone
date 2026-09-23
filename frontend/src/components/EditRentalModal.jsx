import { useState } from 'react';
import { X, Calendar, User, Save, Loader2, Pencil } from 'lucide-react';
import { transactionsService, customerService } from '../services';
import { useToast } from './Toast';
import Field from './ui/Field';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useButtonGuard } from '../hooks/useButtonGuard';
import { customerLabel, itemLabel } from '../utils/format';

const toYmd = (d) => {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// One modal, two tabs:
//  - "Booking"  → edits rental start/due dates + internal notes (PATCH /transactions/:id)
//  - "Customer" → edits the customer contact/profile details (PUT /customers/:id)
// Item & fee stay unchanged in both (cancel + re-book for those). Each tab keeps its
// own backend call, so a failure in one never half-applies the other.
export default function EditRentalModal({ transaction, initialTab = 'booking', onClose, onSaved }) {
  useEscapeClose(onClose);
  const [tab, setTab] = useState(initialTab);

  const inputClass = 'w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53]';
  const custName = customerLabel(transaction.customer) || transaction.customer || '';
  const itmName = itemLabel(transaction.item) || transaction.item || '';

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[130] flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-edit-rental"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md p-5 border-b border-gray-100/80 rounded-t-3xl">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-50 rounded-xl">
                <Pencil size={18} className="text-amber-600" />
              </div>
              <div>
                <h3 id="dialog-title-edit-rental" className="font-bold text-lg text-gray-900">Edit Rental</h3>
                <p className="text-xs text-gray-500 truncate">{itmName}{custName ? ` · ${custName}` : ''}</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close edit rental" className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
              <X size={20} />
            </button>
          </div>

          {/* Tabs */}
          <div role="tablist" aria-label="Edit rental sections" className="mt-4 inline-flex p-1 bg-gray-100 rounded-xl w-full">
            <button role="tab" aria-selected={tab === 'booking'} onClick={() => setTab('booking')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50 ${tab === 'booking' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Calendar size={14} /> Booking
            </button>
            <button role="tab" aria-selected={tab === 'customer'} onClick={() => setTab('customer')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50 ${tab === 'customer' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <User size={14} /> Customer
            </button>
          </div>
        </div>

        <div className="p-5">
          {tab === 'booking'
            ? <BookingTab transaction={transaction} inputClass={inputClass} onClose={onClose} onSaved={onSaved} />
            : <CustomerTab transaction={transaction} inputClass={inputClass} onClose={onClose} onSaved={onSaved} />}
        </div>
      </div>
    </div>
  );
}

function BookingTab({ transaction, inputClass, onClose, onSaved }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [pickup, setPickup] = useState(toYmd(transaction.rentalDate));
  const [due, setDue] = useState(toYmd(transaction.dueDate));
  const [notes, setNotes] = useState(transaction.notes ?? '');
  const [alteration, setAlteration] = useState(transaction.alterationStatus || '');
  // Ref guard: blocks double-tap Save (duplicate PATCH).
  const { guarding: saving, guard: guardSave } = useButtonGuard();

  const handleSave = () => {
    if (!pickup || !due) { toastError('Pickup and due dates are required'); return; }
    if (new Date(pickup) > new Date(due)) { toastError('Pickup must be on or before the due date'); return; }
    guardSave(async () => {
      try {
        const updated = await transactionsService.update(transaction.id, {
          rentalDate: pickup,
          dueDate: due,
          notes,
          alterationStatus: alteration === '' ? null : alteration,
        });
        toastSuccess('Booking updated');
        onSaved?.({ type: 'booking', updated });
        onClose();
      } catch (err) {
        if (err?.status === 409) toastError(err.message || 'Those dates overlap another booking — pick different dates');
        else toastError(err?.message || 'Failed to update booking');
      }
    });
  };

  return (
    <div className="space-y-4">
      <Field label="Pickup date" type="date" required value={pickup} onChange={(e) => setPickup(e.target.value)} className={inputClass} />
      <Field label="Return due date" type="date" required value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} min={pickup} />
      <div>
        <label htmlFor="alteration-status" className="block text-xs font-bold text-gray-700 mb-1.5">Alteration</label>
        <select
          id="alteration-status"
          value={alteration}
          onChange={(e) => setAlteration(e.target.value)}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">No alteration needed</option>
          <option value="pending">Pending — with tailor</option>
          <option value="ready">Ready — fitted, ok for pickup</option>
        </select>
        <p className="text-[10px] text-gray-400 mt-1">Customers see this in Transactions. Date changes notify them automatically.</p>
      </div>
      <Field label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Add a note for staff" />

      <p className="text-[10px] text-gray-400">Item and fee changes require cancel + re-book.</p>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <button onClick={onClose} className="py-3 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl border border-gray-200 transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={saving}
          className="py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Save size={16} /> Save Changes</>}
        </button>
      </div>
    </div>
  );
}

function CustomerTab({ transaction, inputClass, onClose, onSaved }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [form, setForm] = useState({
    name: customerLabel(transaction.customer) || transaction.customer || '',
    phone: transaction.contact || transaction.customerProfile?.phone || '',
    address: transaction.address || transaction.customerProfile?.address || '',
  });
  // Ref guard: blocks double-tap Save (duplicate PUT).
  const { guarding: saving, guard: guardSave } = useButtonGuard();

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const customerId = transaction.customerId || transaction.customer?.id;

  const handleSave = () => {
    if (!customerId) { toastError('No linked customer record to edit'); return; }
    if (!form.name || form.name.trim().length < 2) {
      toastError('Full name is required (min 2 characters)');
      return;
    }
    if (form.phone && form.phone.length !== 11) {
      toastError('Phone must be exactly 11 digits');
      return;
    }
    guardSave(async () => {
      try {
        const updated = await customerService.update(customerId, {
          name: form.name.trim(),
          phone: form.phone || null,
          address: form.address || null,
        });
        toastSuccess('Customer updated');
        onSaved?.({ type: 'customer', updated });
        onClose();
      } catch (err) {
        toastError(err?.message || 'Failed to update customer');
      }
    });
  };

  return (
    <div className="space-y-4">
      <Field label="Full Name" required value={form.name} onChange={(e) => update('name', e.target.value)} className={inputClass} autoComplete="name" />
      <Field label="Phone" type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value.replace(/\D/g, '').slice(0, 11))} className={`${inputClass}${form.phone && form.phone.length !== 11 ? ' border-red-300' : ''}`} inputMode="tel" autoComplete="tel" placeholder="09171234567" />
      {form.phone && form.phone.length !== 11 && <p className="text-[10px] text-red-500 -mt-2">Phone must be exactly 11 digits (e.g. 09171234567)</p>}
      <Field label="Address" value={form.address} onChange={(e) => update('address', e.target.value)} className={inputClass} autoComplete="street-address" placeholder="Street, Balayan, Batangas" />

      <p className="text-[10px] text-gray-400">Item / payment / fee details still require cancel + re-book.</p>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <button onClick={onClose} className="py-3 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl border border-gray-200 transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={saving}
          className="py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Save size={16} /> Save Changes</>}
        </button>
      </div>
    </div>
  );
}
