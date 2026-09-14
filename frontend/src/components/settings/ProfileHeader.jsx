import { useState } from 'react';
import { User, Pencil, Save, X, Phone, MapPin, Heart, Mail } from 'lucide-react';
import { api } from '../../utils/api';
import { ITEM_TYPES } from './constants';

export default function ProfileHeader({ role, profile, customerInfo, onUpdateCustomer, onProfileUpdated }) {
  const [editCustomer, setEditCustomer] = useState(false);
  const [localCustomer, setLocalCustomer] = useState(customerInfo || { name: '', contact: '', address: '', preferences: [], styleNotes: '' });
  const [saveMessage, setSaveMessage] = useState('');

  const [editStaff, setEditStaff] = useState(false);
  const [staffDraft, setStaffDraft] = useState({ name: '', phone: '' });
  const [staffError, setStaffError] = useState('');
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffMsg, setStaffMsg] = useState('');

  const handleSaveCustomer = () => {
    onUpdateCustomer(localCustomer);
    setEditCustomer(false);
    setSaveMessage('Profile updated!');
    setTimeout(() => setSaveMessage(''), 2000);
  };

  const startStaffEdit = () => {
    setStaffDraft({ name: profile?.name || '', phone: profile?.phone || '' });
    setStaffError('');
    setStaffMsg('');
    setEditStaff(true);
  };

  const saveStaffProfile = async () => {
    if (!staffDraft.name.trim()) {
      setStaffError('Name is required');
      return;
    }
    setStaffSaving(true);
    setStaffError('');
    try {
      const updated = await api.put(`/auth/staff/${profile.id}`, {
        name: staffDraft.name.trim(),
        phone: staffDraft.phone.trim() || null,
      });
      setEditStaff(false);
      setStaffMsg('Profile updated!');
      setTimeout(() => setStaffMsg(''), 2500);
      if (onProfileUpdated) onProfileUpdated(updated);
    } catch (err) {
      setStaffError(err?.message || 'Failed to update profile');
    } finally {
      setStaffSaving(false);
    }
  };

  const isEditing = role === 'Customer' ? editCustomer : editStaff;
  const displayName = role === 'Customer' ? (customerInfo?.name || 'Customer') : (profile?.name || role);

  const handleStartEdit = () => {
    if (role === 'Customer') {
      setLocalCustomer({ ...customerInfo, preferences: customerInfo?.preferences || [] });
      setEditCustomer(true);
    } else {
      startStaffEdit();
    }
  };

  const inputClass = 'w-full p-3 bg-[#fafafa] rounded-2xl border border-gray-200 text-sm focus:outline-none focus:border-[#bf4a53] focus:ring-4 focus:ring-[#bf4a53]/10 transition-all font-medium text-gray-800';
  const labelClass = 'text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-1.5 block';

  return (
    <div className="bg-white rounded-3xl shadow-[0_8px_40px_-8px_rgba(0,0,0,0.1)] overflow-hidden">
      {/* Banner */}
      <div className="relative h-28 md:h-36 bg-gradient-to-r from-[#bf4a53] to-[#d4636d] overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full border-2 border-white" />
          <div className="absolute -bottom-10 left-16 w-32 h-32 rounded-full border-2 border-white" />
        </div>
      </div>

      {/* Avatar + info — overlaps banner */}
      <div className="relative px-5 md:px-8">
        {/* Avatar + edit button row */}
        <div className="-mt-12 md:-mt-14 mb-4 flex items-end justify-between gap-3">
          <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-white p-[3px] shadow-lg shrink-0">
            <div className="w-full h-full rounded-full bg-gradient-to-br from-[#fce4e6] to-[#f8d0d4] flex items-center justify-center">
              <User className="w-10 h-10 md:w-12 md:h-12 text-[#bf4a53]" strokeWidth={1.5} />
            </div>
          </div>

          {/* Mobile: edit button even with avatar — desktop: beside name */}
          {!isEditing && (
            <button onClick={handleStartEdit}
              className="sm:hidden inline-flex items-center gap-1 px-3 py-1.5 bg-white border-2 border-[#bf4a53] text-[#bf4a53] rounded-full text-[11px] font-bold hover:bg-[#bf4a53] hover:text-white transition-all shrink-0 mb-2">
              <Pencil size={11} /> Edit
            </button>
          )}
        </div>

        {/* Name + role + desktop edit button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg md:text-xl font-bold text-gray-900">{displayName}</h2>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#bf4a53] bg-red-50 px-2 py-0.5 rounded-full">
                {role}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {role === 'Customer' ? 'Customer Account' : (profile?.email || 'Staff Member')}
            </p>
            {(saveMessage || staffMsg) && (
              <p className="text-xs text-emerald-600 font-semibold mt-1">{saveMessage || staffMsg}</p>
            )}
          </div>

          {!isEditing && (
            <button onClick={handleStartEdit}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border-2 border-[#bf4a53] text-[#bf4a53] rounded-full text-xs font-bold hover:bg-[#bf4a53] hover:text-white transition-all shrink-0 self-center">
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>

        {/* ---- CONTENT ---- */}
        <div className="pb-8">
          {role === 'Customer' ? (
            editCustomer ? (
              /* CUSTOMER EDIT */
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Full Name</label>
                    <input type="text" value={localCustomer.name} onChange={(e) => setLocalCustomer({ ...localCustomer, name: e.target.value })} className={inputClass} placeholder="Full Name" />
                  </div>
                  <div>
                    <label className={labelClass}>Contact Number</label>
                    <input type="text" value={localCustomer.contact} onChange={(e) => setLocalCustomer({ ...localCustomer, contact: e.target.value })} className={inputClass} placeholder="Contact Number" />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Address</label>
                  <input type="text" value={localCustomer.address} onChange={(e) => setLocalCustomer({ ...localCustomer, address: e.target.value })} className={inputClass} placeholder="Full Address" />
                </div>
                <div>
                  <label className={labelClass}>Interested In</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {ITEM_TYPES.map((type) => {
                      const active = (localCustomer.preferences || []).includes(type);
                      return (
                        <button type="button" key={type}
                          onClick={() => setLocalCustomer((prev) => {
                            const has = (prev.preferences || []).includes(type);
                            return { ...prev, preferences: has ? prev.preferences.filter((t) => t !== type) : [...(prev.preferences || []), type] };
                          })}
                          className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${
                            active ? 'bg-[#bf4a53] text-white border-[#bf4a53]' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                          }`}>
                          {type}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1.5 pt-1">
                  <button onClick={() => { setEditCustomer(false); setLocalCustomer(customerInfo); }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 sm:px-4 sm:py-2 sm:gap-1.5 bg-white border-2 border-gray-200 rounded-full text-[11px] sm:text-xs font-bold text-gray-600 hover:bg-gray-50 transition-all">
                    <X size={11} /> Cancel
                  </button>
                  <button onClick={handleSaveCustomer}
                    className="inline-flex items-center gap-1 px-3 py-1.5 sm:px-4 sm:py-2 sm:gap-1.5 bg-[#bf4a53] border-2 border-[#bf4a53] text-white rounded-full text-[11px] sm:text-xs font-bold hover:bg-[#a63f47] transition-all shadow-sm">
                    <Save size={11} /> Save Changes
                  </button>
                </div>
              </div>
            ) : (
              /* CUSTOMER VIEW */
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-center gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100">
                    <div className="w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
                      <Phone size={15} className="text-[#bf4a53]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Phone</p>
                      <p className="text-xs font-semibold text-gray-800 truncate">{customerInfo?.contact || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100">
                    <div className="w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
                      <MapPin size={15} className="text-[#bf4a53]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Address</p>
                      <p className="text-xs font-semibold text-gray-800 truncate">{customerInfo?.address || '—'}</p>
                    </div>
                  </div>
                </div>
                {customerInfo?.preferences?.length > 0 && (
                  <div className="flex items-start gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100">
                    <div className="w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                      <Heart size={15} className="text-[#bf4a53]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Interested in</p>
                      <div className="flex flex-wrap gap-1.5">
                        {customerInfo.preferences.map((p) => (
                          <span key={p} className="px-2.5 py-1 bg-white text-[#bf4a53] rounded-full text-[10px] font-bold border border-red-100">{p}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : editStaff ? (
            /* STAFF EDIT */
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Full Name</label>
                  <input type="text" value={staffDraft.name} onChange={(e) => setStaffDraft({ ...staffDraft, name: e.target.value })} className={inputClass} placeholder="Full Name" />
                </div>
                <div>
                  <label className={labelClass}>Contact Number</label>
                  <input type="text" value={staffDraft.phone} onChange={(e) => setStaffDraft({ ...staffDraft, phone: e.target.value })} className={inputClass} placeholder="Contact Number" />
                </div>
              </div>
              {staffError && <p className="text-[#bf4a53] text-xs font-semibold">{staffError}</p>}
              <div className="flex items-center justify-end gap-1.5 pt-1">
                <button onClick={() => setEditStaff(false)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 sm:px-4 sm:py-2 sm:gap-1.5 bg-white border-2 border-gray-200 rounded-full text-[11px] sm:text-xs font-bold text-gray-600 hover:bg-gray-50 transition-all">
                  <X size={11} /> Cancel
                </button>
                <button onClick={saveStaffProfile} disabled={staffSaving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 sm:px-4 sm:py-2 sm:gap-1.5 bg-[#bf4a53] border-2 border-[#bf4a53] text-white rounded-full text-[11px] sm:text-xs font-bold hover:bg-[#a63f47] transition-all shadow-sm disabled:opacity-50">
                  <Save size={11} /> {staffSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            /* STAFF VIEW */
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100">
                  <div className="w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
                    <User size={15} className="text-[#bf4a53]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Name</p>
                    <p className="text-xs font-semibold text-gray-800 truncate">{profile?.name || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100">
                  <div className="w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
                    <Mail size={15} className="text-[#bf4a53]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Email</p>
                    <p className="text-xs font-semibold text-gray-800 truncate">{profile?.email || '—'}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3.5 bg-[#fafafa] rounded-2xl border border-gray-100">
                <div className="w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center shrink-0">
                  <Phone size={15} className="text-[#bf4a53]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Phone</p>
                  <p className="text-xs font-semibold text-gray-800 truncate">{profile?.phone || '—'}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
