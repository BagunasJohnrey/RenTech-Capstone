import { useState } from 'react';
import { X, Calendar, FileText, Save, Loader2 } from 'lucide-react';
import { transactionsService } from '../services';
import { useToast } from './Toast';
import Field from './ui/Field';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useButtonGuard } from '../hooks/useButtonGuard';

const toYmd = (d) => {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// Edit booking dates + internal notes only. Item and fee stay unchanged
// (cancel + re-book for those). Re-runs the same availability overlap check
// server-side; shows the friendly 409 when it collides.
export default function EditBookingModal({ transaction, onClose, onSaved }) {
  useEscapeClose(onClose);
  const { success: toastSuccess, error: toastError } = useToast();
  const [pickup, setPickup] = useState(toYmd(transaction.rentalDate));
  const [due, setDue] = useState(toYmd(transaction.dueDate));
  const [notes, setNotes] = useState(transaction.notes ?? '');
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
        });
        toastSuccess('Booking updated');
        onSaved?.(updated);
        onClose();
      } catch (err) {
        if (err?.status === 409) toastError(err.message || 'Those dates overlap another booking — pick different dates');
        else toastError(err?.message || 'Failed to update booking');
      }
    });
  };

  const inputClass = 'w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53]';

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[130] flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-edit-booking"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md flex justify-between items-center p-5 border-b border-gray-100/80 rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-50 rounded-xl">
              <Calendar size={18} className="text-amber-600" />
            </div>
            <div>
              <h3 id="dialog-title-edit-booking" className="font-bold text-lg text-gray-900">Edit Booking</h3>
              <p className="text-xs text-gray-500 truncate">{(transaction.item || transaction.itemName || '')} · {transaction.customer || ''}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close edit booking" className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Pickup date" type="date" required value={pickup} onChange={(e) => setPickup(e.target.value)} className={inputClass} />
          <Field label="Return due date" type="date" required value={due} onChange={(e) => setDue(e.target.value)} className={inputClass} min={pickup} />
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
      </div>
    </div>
  );
}
