import { useState, useRef } from 'react';
import { User, Pencil, Save, X, Phone, MapPin, Heart, Mail, Camera, Loader2, Trash2 } from 'lucide-react';
import { api } from '../../utils/api';
import { resolveAvatarUrl } from '../../utils/images';
import PhotoCropper from '../PhotoCropper';
import { ITEM_TYPES } from './constants';
import {
  INPUT_LIMITS,
  sanitizeName,
  sanitizePhone,
  sanitizeAddress,
} from '../../utils/inputLimits';

export default function ProfileHeader({ role, profile, customerInfo, onUpdateCustomer, onProfileUpdated }) {
  const [editCustomer, setEditCustomer] = useState(false);
  const [localCustomer, setLocalCustomer] = useState(customerInfo || { name: '', contact: '', address: '', preferences: [], styleNotes: '' });
  const [saveMessage, setSaveMessage] = useState('');

  const [editStaff, setEditStaff] = useState(false);
  const [staffDraft, setStaffDraft] = useState({ name: '', phone: '' });
  const [staffError, setStaffError] = useState('');
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffMsg, setStaffMsg] = useState('');

  // Profile photo (all roles): resolved to a stable public URL — `avatars/`
  // keys live in the public catalog bucket, unique per upload, so no signing
  // round-trip and no stale-cache risk.
  const avatarPath = profile?.avatarPath || null;
  const avatarUrl = resolveAvatarUrl(avatarPath);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [cropSrc, setCropSrc] = useState(null);
  const fileRef = useRef(null);

  const closeCropper = () => {
    setCropSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  // File pick → circular crop/zoom modal → upload the cropped result.
  const handleAvatarFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarError('');
    if (!file.type.startsWith('image/')) {
      setAvatarError('Choose an image file (JPEG, PNG, or WebP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAvatarError('Photo must be 10MB or smaller.');
      return;
    }
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(URL.createObjectURL(file));
  };

  const handleCropConfirm = async (data) => {
    closeCropper();
    setAvatarUploading(true);
    try {
      // Already a 512px cropped JPEG from the cropper; the server
      // re-normalizes to WebP as the last line of defense.
      const updated = await api.post('/auth/me/avatar', {
        fileName: 'avatar.jpg',
        contentType: 'image/jpeg',
        data,
      });
      if (onProfileUpdated) onProfileUpdated(updated);
    } catch (err) {
      setAvatarError(err?.message || 'Could not upload photo. Try again.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleCropError = () => {
    closeCropper();
    setAvatarError('Could not read that photo. Try another file.');
  };

  const handleRemoveAvatar = async () => {
    setAvatarError('');
    setAvatarUploading(true);
    try {
      const updated = await api.delete('/auth/me/avatar');
      if (onProfileUpdated) onProfileUpdated(updated);
    } catch (err) {
      setAvatarError(err?.message || 'Could not remove photo. Try again.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSaveCustomer = () => {
    const nm = (localCustomer.name || '').trim();
    if (nm.length < INPUT_LIMITS.NAME_MIN || /\d/.test(nm) || nm.length > INPUT_LIMITS.NAME_MAX) return;
    const digits = (localCustomer.contact || '').replace(/\D/g, '');
    if (localCustomer.contact && digits.length !== INPUT_LIMITS.PHONE_LENGTH) return;
    if ((localCustomer.address || '').trim().length > INPUT_LIMITS.ADDRESS_MAX) return;
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
    const nm = staffDraft.name.trim();
    if (!nm) {
      setStaffError('Name is required');
      return;
    }
    if (/\d/.test(nm)) {
      setStaffError('Name must not contain numbers');
      return;
    }
    if (nm.length > INPUT_LIMITS.NAME_MAX) {
      setStaffError(`Name must be ${INPUT_LIMITS.NAME_MAX} characters or fewer`);
      return;
    }
    if (staffDraft.phone.trim() && staffDraft.phone.replace(/\D/g, '').length !== INPUT_LIMITS.PHONE_LENGTH) {
      setStaffError(`Phone must be exactly ${INPUT_LIMITS.PHONE_LENGTH} digits`);
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
          <div className="flex items-end gap-2">
            <div className="relative shrink-0">
              <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-white p-[3px] shadow-lg">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile photo"
                    className="w-full h-full rounded-full object-cover bg-gradient-to-br from-[#fce4e6] to-[#f8d0d4]"
                  />
                ) : (
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-[#fce4e6] to-[#f8d0d4] flex items-center justify-center">
                    <User className="w-10 h-10 md:w-12 md:h-12 text-[#bf4a53]" strokeWidth={1.5} />
                  </div>
                )}
                {avatarUploading && (
                  <div className="absolute inset-0 rounded-full bg-white/70 flex items-center justify-center">
                    <Loader2 size={22} className="text-[#bf4a53] animate-spin" />
                  </div>
                )}
              </div>
              {/* Change photo */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={avatarUploading}
                aria-label={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
                title={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
                className="absolute -bottom-1 -right-1 w-10 h-10 rounded-full bg-[#bf4a53] text-white border-[3px] border-white shadow-md flex items-center justify-center hover:bg-[#a63f47] transition-colors disabled:opacity-60"
              >
                <Camera size={16} />
              </button>
              {/* Remove photo (edit mode only) */}
              {avatarUrl && isEditing && !avatarUploading && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  aria-label="Remove profile photo"
                  title="Remove profile photo"
                  className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-white text-red-500 border border-red-200 shadow-md flex items-center justify-center hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarFile}
              />
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
        {avatarError && (
          <p className="text-xs text-red-500 font-semibold -mt-2 mb-4">{avatarError}</p>
        )}
        {cropSrc && (
          <PhotoCropper
            src={cropSrc}
            onCancel={closeCropper}
            onConfirm={handleCropConfirm}
            onError={handleCropError}
          />
        )}

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
                    <input type="text" value={localCustomer.name} onChange={(e) => setLocalCustomer({ ...localCustomer, name: sanitizeName(e.target.value) })} className={inputClass} placeholder="Full Name" maxLength={INPUT_LIMITS.NAME_MAX} />
                  </div>
                  <div>
                    <label className={labelClass}>Contact Number</label>
                    <input type="text" inputMode="numeric" value={localCustomer.contact} onChange={(e) => setLocalCustomer({ ...localCustomer, contact: sanitizePhone(e.target.value) })} className={inputClass} placeholder="Contact Number" maxLength={INPUT_LIMITS.PHONE_LENGTH} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Address</label>
                  <input type="text" value={localCustomer.address} onChange={(e) => setLocalCustomer({ ...localCustomer, address: sanitizeAddress(e.target.value) })} className={inputClass} placeholder="Full Address" maxLength={INPUT_LIMITS.ADDRESS_MAX} />
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
                  <input type="text" value={staffDraft.name} onChange={(e) => setStaffDraft({ ...staffDraft, name: sanitizeName(e.target.value) })} className={inputClass} placeholder="Full Name" maxLength={INPUT_LIMITS.NAME_MAX} />
                </div>
                <div>
                  <label className={labelClass}>Contact Number</label>
                  <input type="text" inputMode="numeric" value={staffDraft.phone} onChange={(e) => setStaffDraft({ ...staffDraft, phone: sanitizePhone(e.target.value) })} className={inputClass} placeholder="Contact Number" maxLength={INPUT_LIMITS.PHONE_LENGTH} />
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
