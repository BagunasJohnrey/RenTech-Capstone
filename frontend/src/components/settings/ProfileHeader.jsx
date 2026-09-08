import { useState } from 'react';
import { User, Pencil, Save, X, Phone, MapPin, Heart, Mail } from 'lucide-react';
import { api } from '../../utils/api';
import { ITEM_TYPES } from './constants';

export default function ProfileHeader({ role, profile, customerInfo, onUpdateCustomer, onProfileUpdated }) {
  const [editCustomer, setEditCustomer] = useState(false);
  const [localCustomer, setLocalCustomer] = useState(customerInfo || { name: '', contact: '', address: '', preferences: [], styleNotes: '' });
  const [saveMessage, setSaveMessage] = useState('');

  // Staff/Admin self-edit (name/phone). Email is the login identity — read-only.
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
      // PUT /auth/staff/:id allows the staff member to edit their own
      // profile (admins can edit anyone's from the Team tab).
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

  const inputClass = 'w-full p-3 bg-white rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/10 transition-all';

  const displayName = role === 'Customer' ? (customerInfo?.name || 'Customer') : (profile?.name || role);

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Banner */}
      <div className="h-28 md:h-36 bg-gradient-to-r from-[#bf4a53] to-[#e07080] overflow-hidden relative">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 right-8 w-32 h-32 border border-white/30 rounded-full" />
          <div className="absolute -bottom-6 left-12 w-24 h-24 border border-white/20 rounded-full" />
          <div className="absolute top-8 left-1/3 w-16 h-16 border border-white/20 rounded-full" />
        </div>
      </div>

      {/* Content */}
      <div className="px-5 md:px-8 pb-6 -mt-10 md:-mt-12 relative">
        {/* Avatar */}
        <div className="mb-4">
          <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-white border-4 border-white shadow-md flex items-center justify-center">
            <User size={32} className="text-[#bf4a53] md:w-10 md:h-10" />
          </div>
        </div>

        {/* Name + role */}
        <div className="mb-5">
          <h3 className="text-xl md:text-2xl font-bold text-gray-900">{displayName}</h3>
          <span className="inline-block mt-1.5 text-[11px] font-bold uppercase tracking-wider text-[#bf4a53] bg-red-50 px-2.5 py-1 rounded-lg">
            {role}
          </span>
        </div>

        {role === 'Customer' ? (
          editCustomer ? (
            /* ---- EDIT MODE ---- */
            <div className="space-y-4">
              {/* Edit header */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-10 h-10 rounded-full bg-[#bf4a53]/10 flex items-center justify-center shrink-0">
                  <Pencil size={16} className="text-[#bf4a53]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Editing Profile</p>
                  <p className="text-[11px] text-gray-400">Update your details below</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Full Name</label>
                  <input type="text" value={localCustomer.name} onChange={(e) => setLocalCustomer({ ...localCustomer, name: e.target.value })} className={inputClass} placeholder="Full Name" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Contact Number</label>
                  <input type="text" value={localCustomer.contact} onChange={(e) => setLocalCustomer({ ...localCustomer, contact: e.target.value })} className={inputClass} placeholder="Contact Number" />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Address</label>
                <input type="text" value={localCustomer.address} onChange={(e) => setLocalCustomer({ ...localCustomer, address: e.target.value })} className={inputClass} placeholder="Address" />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 block">Interested In</label>
                <div className="flex flex-wrap gap-2">
                  {ITEM_TYPES.map((type) => {
                    const active = (localCustomer.preferences || []).includes(type);
                    return (
                      <button
                        type="button"
                        key={type}
                        onClick={() =>
                          setLocalCustomer((prev) => {
                            const has = (prev.preferences || []).includes(type);
                            return {
                              ...prev,
                              preferences: has
                                ? prev.preferences.filter((t) => t !== type)
                                : [...(prev.preferences || []), type],
                            };
                          })
                        }
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${active ? 'bg-[#bf4a53] text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => { setEditCustomer(false); setLocalCustomer(customerInfo); }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-200 rounded-full text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                  <X size={15} /> Cancel
                </button>
                <button onClick={handleSaveCustomer}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20">
                  <Save size={15} /> Save
                </button>
              </div>
              {saveMessage && <p className="text-sm text-emerald-600 font-bold text-right">{saveMessage}</p>}
            </div>
          ) : (
            /* ---- VIEW MODE ---- */
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="w-9 h-9 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0">
                    <User size={15} className="text-gray-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Name</p>
                    <p className="text-sm font-semibold text-gray-900 break-words">{customerInfo.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="w-9 h-9 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0">
                    <Phone size={15} className="text-gray-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact</p>
                    <p className="text-sm font-semibold text-gray-900 break-words">{customerInfo.contact}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0">
                  <MapPin size={15} className="text-gray-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Address</p>
                  <p className="text-sm font-semibold text-gray-900 break-words">{customerInfo.address}</p>
                </div>
              </div>

              {customerInfo.preferences?.length > 0 && (
                <div className="p-3 bg-gray-50 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Heart size={13} className="text-[#bf4a53]" />
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Interested In</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {customerInfo.preferences.map((p) => (
                      <span key={p} className="px-3 py-1 bg-red-50 text-[#bf4a53] rounded-full text-xs font-bold">{p}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  onClick={() => { setLocalCustomer({ ...customerInfo, preferences: customerInfo?.preferences || [] }); setEditCustomer(true); }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20"
                >
                  <Pencil size={15} /> Edit Profile
                </button>
              </div>
            </div>
          )
        ) : editStaff ? (
          /* ---- STAFF/ADMIN EDIT MODE ---- */
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="w-10 h-10 rounded-full bg-[#bf4a53]/10 flex items-center justify-center shrink-0">
                <Pencil size={16} className="text-[#bf4a53]" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Editing Profile</p>
                <p className="text-[11px] text-gray-400">Your email is your login and can't be changed</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Full Name</label>
                <input type="text" value={staffDraft.name} onChange={(e) => setStaffDraft({ ...staffDraft, name: e.target.value })} className={inputClass} placeholder="Full Name" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">Phone</label>
                <input type="text" value={staffDraft.phone} onChange={(e) => setStaffDraft({ ...staffDraft, phone: e.target.value })} className={inputClass} placeholder="Contact Number" />
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="w-9 h-9 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0">
                <Mail size={15} className="text-gray-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Email (login — read-only)</p>
                <p className="text-sm font-semibold text-gray-900 truncate">{profile?.email || '—'}</p>
              </div>
            </div>

            {staffError && <p className="text-red-500 text-xs font-semibold text-right">{staffError}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditStaff(false)}
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-200 rounded-full text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                <X size={15} /> Cancel
              </button>
              <button onClick={saveStaffProfile} disabled={staffSaving}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20 disabled:opacity-50">
                <Save size={15} /> {staffSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          /* ---- STAFF/ADMIN VIEW MODE ---- */
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0">
                  <User size={15} className="text-gray-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Name</p>
                  <p className="text-sm font-semibold text-gray-900 truncate">{profile?.name || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0">
                  <Mail size={15} className="text-gray-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Email</p>
                  <p className="text-sm font-semibold text-gray-900 truncate">{profile?.email || '—'}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="w-9 h-9 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0">
                <Phone size={15} className="text-gray-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Phone</p>
                <p className="text-sm font-semibold text-gray-900 truncate">{profile?.phone || '—'}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              {staffMsg ? (
                <p className="text-sm text-emerald-600 font-bold">{staffMsg}</p>
              ) : <span />}
              <button
                onClick={startStaffEdit}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-500/20"
              >
                <Pencil size={15} /> Edit Profile
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
