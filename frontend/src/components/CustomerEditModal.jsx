import { useState } from 'react';
import { X, User, Save, Loader2 } from 'lucide-react';
import { customerService } from '../services';
import { useToast } from './Toast';
import Field from './ui/Field';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useButtonGuard } from '../hooks/useButtonGuard';
import {
  INPUT_LIMITS,
  sanitizeName,
  sanitizePhone,
  sanitizeAddress,
} from '../utils/inputLimits';

// Edit only contact/profile details — item + fee changes stay "cancel + re-book".
export default function CustomerEditModal({ customer, onClose, onSaved }) {
  useEscapeClose(onClose);
  const { success: toastSuccess, error: toastError } = useToast();
  const [form, setForm] = useState({
    name: customer.name ?? '',
    phone: customer.phone ?? '',
    address: customer.address ?? '',
    preferences: customer.preferences ?? '',
  });
  // Ref guard: blocks double-tap Save (duplicate customer updates).
  const { guarding: saving, guard: guardSave } = useButtonGuard();

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = () => {
    const nameTrimmed = (form.name || '').trim();
    if (nameTrimmed.length < INPUT_LIMITS.NAME_MIN) {
      toastError('Full name is required (min 2 characters)');
      return;
    }
    if (/\d/.test(nameTrimmed)) {
      toastError('Name must not contain numbers');
      return;
    }
    if (nameTrimmed.length > INPUT_LIMITS.NAME_MAX) {
      toastError(`Name must be ${INPUT_LIMITS.NAME_MAX} characters or fewer`);
      return;
    }
    if (form.phone && form.phone.length !== INPUT_LIMITS.PHONE_LENGTH) {
      toastError(`Phone must be exactly ${INPUT_LIMITS.PHONE_LENGTH} digits`);
      return;
    }
    if (form.address && form.address.trim().length > INPUT_LIMITS.ADDRESS_MAX) {
      toastError(`Address must be ${INPUT_LIMITS.ADDRESS_MAX} characters or fewer`);
      return;
    }
    guardSave(async () => {
      try {
        const prefs = typeof form.preferences === 'string'
          ? form.preferences.split(',').map(s => s.trim()).filter(Boolean)
          : form.preferences;
        const updated = await customerService.update(customer.id, {
          name: form.name.trim(),
          phone: form.phone || null,
          address: form.address || null,
          preferences: prefs,
        });
        toastSuccess('Customer updated');
        onSaved?.(updated);
        onClose();
      } catch (err) {
        toastError(err?.message || 'Failed to update customer');
      }
    });
  };

  const inputClass = 'w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53]';

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-edit-customer"
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md flex justify-between items-center p-5 border-b border-gray-100/80 rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 rounded-xl">
              <User size={18} className="text-blue-600" />
            </div>
            <div>
              <h3 id="dialog-title-edit-customer" className="font-bold text-lg text-gray-900">Edit Customer</h3>
              <p className="text-xs text-gray-500 truncate">{customer.name || customer.email}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close edit customer" className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Full Name" required value={form.name} onChange={(e) => update('name', sanitizeName(e.target.value))} className={inputClass} autoComplete="name" maxLength={INPUT_LIMITS.NAME_MAX} />
          <Field label="Phone" type="tel" value={form.phone} onChange={(e) => update('phone', sanitizePhone(e.target.value))} className={`${inputClass}${form.phone && form.phone.length !== 11 ? ' border-red-300' : ''}`} inputMode="numeric" autoComplete="tel" placeholder="09171234567" maxLength={INPUT_LIMITS.PHONE_LENGTH} />
          {form.phone && form.phone.length !== 11 && <p className="text-[10px] text-red-500 -mt-2">Phone must be exactly 11 digits (e.g. 09171234567)</p>}
          <Field label="Address" value={form.address} onChange={(e) => update('address', sanitizeAddress(e.target.value))} className={inputClass} autoComplete="street-address" placeholder="Street, Balayan, Batangas" maxLength={INPUT_LIMITS.ADDRESS_MAX} />
          <Field label="Interests (comma separated item types)" value={form.preferences}
            onChange={(e) => update('preferences', e.target.value)} className={inputClass}
            placeholder="Gown, Suit, Barong" />

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button onClick={onClose} className="py-3 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl border border-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="py-3 bg-[#bf4a53] text-white font-bold text-sm rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Save size={16} /> Save Changes</>}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 text-center">Item / payment / fee details still require cancel + re-book.</p>
        </div>
      </div>
    </div>
  );
}
