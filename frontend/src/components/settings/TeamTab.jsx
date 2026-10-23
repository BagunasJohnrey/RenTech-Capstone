import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, Plus, Trash2, AlertCircle, Key, ShieldCheck, Lock, CheckCircle2, Pencil, X } from 'lucide-react';
import { api } from '../../utils/api';
import CollapsibleCard from './CollapsibleCard';
import PinInput from './PinInput';
import {
  INPUT_LIMITS,
  sanitizeName,
  sanitizePhone,
} from '../../utils/inputLimits';

// Admin Team & Security tab: staff account management + the admin's own TOTP
// two-factor authentication (setup QR, enable, backup codes, disable).
export default function TeamTab({ staffList, staffLoadError, onAddStaff, onRemoveStaff, onUpdateStaff, profile }) {
  const [newUsername, setNewUsername] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [staffError, setStaffError] = useState('');
  const [staffAdding, setStaffAdding] = useState(false);
  // One-time password reveal: shown once right after creation, then gone.
  const [createdOtp, setCreatedOtp] = useState(null);
  const [otpCopied, setOtpCopied] = useState(false);

  // Edit staff account (name/phone — email is the login identity, immutable).
  const [editTarget, setEditTarget] = useState(null);
  const [editDraft, setEditDraft] = useState({ name: '', phone: '' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Phase 5: MFA management (Admin only)
  const [mfaStep, setMfaStep] = useState(profile?.mfaEnabled ? 'enabled' : 'idle');
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaQrUri, setMfaQrUri] = useState('');
  const [mfaQrDataUri, setMfaQrDataUri] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBackupCodes, setMfaBackupCodes] = useState([]);
  const [mfaError, setMfaError] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);

  // Admin discount PIN (staff present it when applying a discount)
  const [pinConfigured, setPinConfigured] = useState(null);
  const [pin, setPin] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [pinPassword, setPinPassword] = useState('');
  const [pinSaved, setPinSaved] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [showPinReset, setShowPinReset] = useState(false);

  useEffect(() => {
    let active = true;
    api.get('/auth/admin-pin')
      .then((res) => { if (active) setPinConfigured(Boolean(res?.configured)); })
      .catch((err) => {
        if (!active) return;
        // MFA-gated: a 403 means this session hasn't verified the second
        // factor for its current token (e.g. rotation after the sign-in
        // expired in the background). Surface WHY instead of a silently dead
        // "Add PIN" button — the verification prompt opens automatically.
        if (err?.status === 403) {
          setPinError(
            err?.body?.code === 'mfa_challenge_required'
              ? 'This session needs a quick MFA verification — enter your authenticator code in the prompt (no need to sign out), then retry.'
              : err?.body?.error || 'Not available in this session.'
          );
        }
        setPinConfigured(false);
      });
    return () => { active = false; };
  }, []);

  const handleSavePin = async (isReset) => {
    setPinError('');
    setPinSaved(false);
    if (!/^\d{4}$/.test(pin)) {
      setPinError('Enter exactly 4 digits for the new PIN');
      return;
    }
    if (isReset) {
      if (!/^\d{4}$/.test(oldPin)) {
        setPinError('Enter your current PIN');
        return;
      }
      if (!pinPassword) {
        setPinError('Enter your admin password to confirm the reset');
        return;
      }
    }
    setPinLoading(true);
    try {
      await api.put('/auth/admin-pin', isReset ? { pin, oldPin, password: pinPassword } : { pin });
      setPin('');
      setOldPin('');
      setPinPassword('');
      setPinConfigured(true);
      setPinSaved(true);
      setShowPinReset(false);
    } catch (err) {
      setPinError(err?.message || 'Failed to save PIN');
    } finally {
      setPinLoading(false);
    }
  };

  const handleMfaSetup = async () => {
    setMfaError('');
    setMfaLoading(true);
    try {
      const res = await api.post('/auth/mfa/setup');
      setMfaSecret(res.secret);
      setMfaQrUri(res.qrUri);
      setMfaQrDataUri(res.qrDataUri || '');
      setMfaStep('setup');
    } catch (err) {
      setMfaError(err?.message || 'Failed to set up MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaEnable = async () => {
    setMfaError('');
    if (mfaCode.length !== 6) {
      setMfaError('Please enter the 6-digit code from your authenticator app');
      return;
    }
    setMfaLoading(true);
    try {
      // Server generates cryptographically random backup codes; we don't send
      // client-generated ones. They're shown once — save them.
      const res = await api.post('/auth/mfa/enable', { code: mfaCode });
      setMfaBackupCodes(res.backupCodes || []);
      setMfaStep('backupCodes'); // new step: show generated backup codes
      setMfaError('');
      if (profile) profile.mfaEnabled = true;
    } catch (err) {
      setMfaError(err?.message || 'Failed to enable MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaDisable = async () => {
    setMfaError('');
    setMfaLoading(true);
    try {
      await api.post('/auth/mfa/disable');
      setMfaStep('idle');
      setMfaSecret('');
      setMfaQrUri('');
      setMfaQrDataUri('');
      if (profile) profile.mfaEnabled = false;
    } catch (err) {
      setMfaError(err?.message || 'Failed to disable MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const copyBackupCodes = async () => {
    if (!mfaBackupCodes.length) return;
    try {
      await navigator.clipboard.writeText(mfaBackupCodes.join('\n'));
    } catch {
      // clipboard API unavailable — just leave the codes visible for manual copy
    }
  };

  const handleAddStaff = async (e) => {
    e.preventDefault();
    setStaffError('');
    if (!newUsername) return;
    setStaffAdding(true);
    try {
      // The backend generates a one-time password; show it once for the admin
      // to share with the staff member out of band. First login forces a change.
      const created = await onAddStaff({ email: newUsername, name: newStaffName || newUsername });
      setNewUsername('');
      setNewStaffName('');
      setCreatedOtp({
        name: created?.name || newStaffName || newUsername,
        email: created?.email || newUsername,
        password: created?.oneTimePassword,
      });
    } catch (err) {
      setStaffError(err?.message || 'Failed to add staff. Check the email format and try again.');
    } finally {
      setStaffAdding(false);
    }
  };

  const copyOtp = async () => {
    if (!createdOtp?.password) return;
    try {
      await navigator.clipboard.writeText(createdOtp.password);
      setOtpCopied(true);
      setTimeout(() => setOtpCopied(false), 2000);
    } catch {
      // clipboard unavailable — leave the code visible for manual copy
    }
  };

  const startEditStaff = (staff) => {
    setEditTarget(staff);
    setEditDraft({ name: staff.name || '', phone: staff.phone || '' });
    setEditError('');
  };

  const saveEditStaff = async () => {
    const nm = editDraft.name.trim();
    if (!nm) {
      setEditError('Name is required');
      return;
    }
    if (/\d/.test(nm)) {
      setEditError('Name must not contain numbers');
      return;
    }
    if (nm.length > INPUT_LIMITS.NAME_MAX) {
      setEditError(`Name must be ${INPUT_LIMITS.NAME_MAX} characters or fewer`);
      return;
    }
    if (editDraft.phone.trim() && editDraft.phone.replace(/\D/g, '').length !== INPUT_LIMITS.PHONE_LENGTH) {
      setEditError(`Phone must be exactly ${INPUT_LIMITS.PHONE_LENGTH} digits`);
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await onUpdateStaff(editTarget.id, {
        name: editDraft.name.trim(),
        phone: editDraft.phone.trim() || null,
      });
      setEditTarget(null);
    } catch (err) {
      setEditError(err?.message || 'Failed to update staff account');
    } finally {
      setEditSaving(false);
    }
  };

  const inputClass = 'bg-gray-50 border border-gray-200/80 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:bg-white focus:border-gray-400';

  return (
    <>
      {/* Staff Management */}
      {staffList !== undefined && (
        <CollapsibleCard
          icon={Users}
          iconClass="bg-red-50 text-[#bf4a53]"
          title="Staff Management"
          subtitle="Create and manage staff accounts"
          storageKey="settings-team-staff-open"
          badge={
            staffList.length > 0 ? (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#bf4a53]/10 text-[#bf4a53] text-[11px] font-bold tabular-nums">
                {staffList.length} staff
              </span>
            ) : null
          }
        >
          {staffError && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {staffError}
            </div>
          )}
          <form onSubmit={handleAddStaff} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
            <input type="text" placeholder="Name" value={newStaffName} onChange={(e) => setNewStaffName(sanitizeName(e.target.value))} className={inputClass} maxLength={INPUT_LIMITS.NAME_MAX} />
            <input type="text" placeholder="Username (email)" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className={inputClass} required />
            <button type="submit" disabled={staffAdding} className="bg-[#bf4a53] text-white px-5 py-3 rounded-full text-sm font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-2 shadow-sm shadow-red-500/20 disabled:opacity-50">
              <Plus size={16} /> {staffAdding ? 'Adding...' : 'Add'}
            </button>
          </form>
          <p className="text-xs text-gray-500 mt-2">
            A one-time password is generated automatically — share it with the staff member privately.
            They'll be asked to choose their own password the first time they sign in.
          </p>

          {createdOtp && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
              <div className="flex items-start gap-2">
                <Key size={16} className="text-amber-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-amber-900">
                    Staff account created for {createdOtp.name}
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Share this one-time password with them now — it won't be shown again. Their first
                    sign-in will ask them to set a new password.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="flex-1 min-w-[180px] bg-white border border-amber-200 rounded-xl px-4 py-2.5 font-mono text-sm font-semibold text-gray-900 break-all">
                  {createdOtp.password}
                </code>
                <button
                  onClick={copyOtp}
                  className="px-4 py-2.5 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 transition-colors"
                >
                  {otpCopied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => { setCreatedOtp(null); setOtpCopied(false); }}
                  className="px-4 py-2.5 border border-gray-200 bg-white text-gray-600 text-sm font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {staffLoadError?.status === 403 ? (
            <div className="flex items-start gap-2 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-800 font-medium">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>
                {staffLoadError?.body?.code === 'mfa_challenge_required'
                  ? 'This session needs a quick MFA verification — enter your authenticator code in the prompt (no need to sign out). The list reloads automatically once verified.'
                  : staffLoadError?.body?.error || 'Staff list is unavailable in this session.'}
              </span>
            </div>
          ) : staffList.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No staff accounts yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {staffList.map((staff) => (
                <div key={staff.id} className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-gray-50/70 border border-gray-100">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
                      {(staff.name || staff.email || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{staff.name || staff.email}</p>
                      <p className="text-xs text-gray-500 truncate">{staff.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {staff.createdAt && (
                      <span className="text-[10px] text-gray-400 hidden sm:block">Added {new Date(staff.createdAt).toLocaleDateString()}</span>
                    )}
                    <button
                      onClick={() => startEditStaff(staff)}
                      className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-full transition-colors"
                      title={`Edit ${staff.name || staff.email}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => onRemoveStaff(staff)}
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-full transition-colors"
                      title={`Remove ${staff.name || staff.email}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>
      )}

      {/* Two-Factor Authentication */}
      <CollapsibleCard
        icon={Key}
        iconClass="bg-gray-900 text-white"
        title="Two-Factor Authentication"
        subtitle="Protect this admin account with a TOTP authenticator app"
        storageKey="settings-team-mfa-open"
        defaultOpen={false}
        badge={
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${profile?.mfaEnabled || mfaStep === 'enabled' || mfaStep === 'backupCodes' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
            {profile?.mfaEnabled || mfaStep === 'enabled' || mfaStep === 'backupCodes' ? 'Active' : 'Off'}
          </span>
        }
      >
        {mfaError && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium">
            <AlertCircle size={16} /> {mfaError}
          </div>
        )}

        {mfaStep === 'idle' && (
          <>
            <p className="text-sm text-gray-500">
              {profile?.mfaEnabled
                ? 'MFA is currently enabled for your account.'
                : 'Add an extra layer of security to your admin account with TOTP-based two-factor authentication.'}
            </p>
            {profile?.mfaEnabled ? (
              <button onClick={handleMfaDisable} disabled={mfaLoading} className="px-4 py-2 border border-red-200 bg-red-50 text-[#bf4a53] font-semibold rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50">
                {mfaLoading ? 'Disabling...' : 'Disable MFA'}
              </button>
            ) : (
              <button onClick={handleMfaSetup} disabled={mfaLoading} className="px-4 py-2 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50">
                {mfaLoading ? 'Setting up...' : 'Set Up MFA'}
              </button>
            )}
          </>
        )}

        {mfaStep === 'setup' && mfaQrUri && (
          <div className="grid gap-4 md:grid-cols-2 md:items-start">
            <div>
              <p className="text-sm text-gray-500 mb-3">
                Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.),
                then enter the 6-digit code it generates.
              </p>
              <div className="flex items-center justify-center p-4 bg-gray-50 rounded-2xl">
                {mfaQrDataUri ? (
                  <img src={mfaQrDataUri} alt="MFA QR Code" className="w-44 h-44 md:w-48 md:h-48 object-contain" />
                ) : (
                  /* Fallback: show the typed-out setup key if the QR image is unavailable */
                  <div className="text-center p-4">
                    <p className="text-xs text-gray-500 mb-2">QR unavailable — enter this key manually:</p>
                    <p className="font-mono text-sm font-semibold text-gray-900 break-all">{mfaSecret}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Authentication Code</label>
                <input
                  type="text"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono text-center text-gray-900 focus:outline-none focus:bg-white focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15"
                  maxLength={6}
                />
              </div>
              <button
                onClick={handleMfaEnable}
                disabled={mfaLoading || mfaCode.length !== 6}
                className="w-full px-4 py-3 min-h-[48px] bg-[#bf4a53] text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {mfaLoading ? 'Enabling...' : 'Enable MFA'}
              </button>
            </div>
          </div>
        )}

        {mfaStep === 'backupCodes' && mfaBackupCodes.length > 0 && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-sm font-medium text-amber-800">Save these backup codes now</p>
              <p className="text-xs text-amber-600 mt-1">You won't see them again. Each code can be used once if you lose access to your authenticator app.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {mfaBackupCodes.map((code, i) => (
                <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 font-mono text-sm text-center">{code}</div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={copyBackupCodes} className="flex-1 px-4 py-2 border border-gray-200 bg-white text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm">
                Copy Codes
              </button>
              <button
                onClick={() => { setMfaStep('enabled'); setMfaQrUri(''); setMfaQrDataUri(''); setMfaCode(''); }}
                className="flex-1 px-4 py-2 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {mfaStep === 'enabled' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-2xl">
              <ShieldCheck size={20} className="text-emerald-500" />
              <span className="text-sm font-medium text-emerald-800">MFA is active on this account</span>
            </div>
            <button onClick={handleMfaDisable} disabled={mfaLoading} className="px-4 py-2 border border-red-200 bg-red-50 text-[#bf4a53] font-semibold rounded-xl hover:bg-red-100 transition-colors disabled:opacity-50">
              {mfaLoading ? 'Disabling...' : 'Disable MFA'}
            </button>
          </div>
        )}
      </CollapsibleCard>

      {/* Discount Authorization PIN */}
      <CollapsibleCard
        icon={Lock}
        iconClass="bg-red-50 text-[#bf4a53]"
        title="Discount Authorization PIN"
        subtitle="Set a 4-digit PIN that staff enter to approve discounts on rentals"
        storageKey="settings-team-pin-open"
        defaultOpen={false}
        badge={
          pinConfigured ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[11px] font-bold">
              Set
            </span>
          ) : null
        }
      >
        <p className="text-sm text-gray-500">
          When staff apply a discount in the new-rental flow, they'll be asked for this PIN
          instead of admin email and password. Keep it to 4 digits.
        </p>
        {pinError && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium">
            <AlertCircle size={16} /> {pinError}
          </div>
        )}
        {pinSaved && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-2xl text-sm text-emerald-700 font-medium">
            <CheckCircle2 size={16} /> Discount PIN saved
          </div>
        )}
        {pinConfigured === null ? (
          <p className="text-sm text-gray-400">Checking…</p>
        ) : pinConfigured ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-2xl">
              <ShieldCheck size={16} className="text-emerald-500" />
              <span className="text-sm font-medium text-emerald-800">PIN is set — staff can already approve discounts.</span>
            </div>
            <button
              onClick={() => { setPinError(''); setPinSaved(false); setPin(''); setOldPin(''); setPinPassword(''); setShowPinReset(true); }}
              className="px-4 py-2 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors text-sm"
            >
              Reset PIN
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">New PIN</label>
              <PinInput
                value={pin}
                onChange={setPin}
                onEnter={() => handleSavePin(false)}
              />
            </div>
            <button
              onClick={() => handleSavePin(false)}
              disabled={pinLoading || pin.length !== 4}
              className="px-4 py-2 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm"
            >
              {pinLoading ? 'Saving...' : 'Add PIN'}
            </button>
          </div>
        )}
      </CollapsibleCard>

      {/* Edit staff modal — portaled to document.body so it sits above every
          component (the settings page wrapper animates transforms, which would
          otherwise trap a fixed-position child in a stacking context). */}
      {editTarget && createPortal(
        <div className="fixed inset-0 z-[9999] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditTarget(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-edit-staff" className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4 pointer-events-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 id="dialog-title-edit-staff" className="font-bold text-gray-900">Edit Staff Account</h4>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{editTarget.email}</p>
              </div>
              <button
                onClick={() => setEditTarget(null)}
                aria-label="Close edit staff dialog"
                className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-gray-500 -mt-1">Update their name or contact number. The email is their login and can't be changed.</p>
            {editError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium">
                <AlertCircle size={16} /> {editError}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Name</label>
              <input
                type="text"
                value={editDraft.name}
                onChange={(e) => { setEditDraft({ ...editDraft, name: sanitizeName(e.target.value) }); if (editError) setEditError(''); }}
                className="w-full p-3 bg-gray-50 rounded-xl border text-sm text-gray-900 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15"
                placeholder="Staff name"
                maxLength={INPUT_LIMITS.NAME_MAX}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Phone</label>
              <input
                type="text"
                inputMode="numeric"
                value={editDraft.phone}
                onChange={(e) => { setEditDraft({ ...editDraft, phone: sanitizePhone(e.target.value) }); if (editError) setEditError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEditStaff(); }}
                className="w-full p-3 bg-gray-50 rounded-xl border text-sm text-gray-900 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15"
                placeholder="0917 123 4567"
                maxLength={INPUT_LIMITS.PHONE_LENGTH}
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setEditTarget(null)}
                className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEditStaff}
                disabled={editSaving || !editDraft.name.trim()}
                className="flex-1 py-2.5 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Reset PIN modal — portaled to document.body so it sits above every
          component (the settings page wrapper animates transforms, which would
          otherwise trap a fixed-position child in a stacking context). */}
      {showPinReset && createPortal(
        <div className="fixed inset-0 z-[9999] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowPinReset(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-reset-pin" className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4 pointer-events-auto" onClick={e => e.stopPropagation()}>
            <h4 id="dialog-title-reset-pin" className="font-bold text-gray-900">Reset Discount PIN</h4>
            <p className="text-xs text-gray-500">Enter your current PIN, choose a new 4-digit PIN, and confirm with your admin password.</p>
            {pinError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium">
                <AlertCircle size={16} /> {pinError}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Current PIN</label>
              <PinInput value={oldPin} onChange={setOldPin} autoFocus />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">New PIN</label>
              <PinInput value={pin} onChange={setPin} onEnter={() => handleSavePin(true)} />
            </div>
            <input
              type="password"
              value={pinPassword}
              onChange={(e) => setPinPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSavePin(true); }}
              placeholder="Admin password"
              className="w-full p-3 bg-gray-50 rounded-xl border text-sm text-gray-900 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15"
            />
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setShowPinReset(false); setPinError(''); setPinSaved(false); setPin(''); setOldPin(''); setPinPassword(''); }}
                className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSavePin(true)}
                disabled={pinLoading || pin.length !== 4 || oldPin.length !== 4 || !pinPassword}
                className="flex-1 py-2.5 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {pinLoading ? 'Resetting...' : 'Reset PIN'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
