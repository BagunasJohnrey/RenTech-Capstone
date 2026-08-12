import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, Plus, Trash2, AlertCircle, Key, ShieldCheck, Lock, CheckCircle2 } from 'lucide-react';
import { api } from '../../utils/api';
import SettingsCard from './SettingsCard';
import PinInput from './PinInput';

// Admin Team & Security tab: staff account management + the admin's own TOTP
// two-factor authentication (setup QR, enable, backup codes, disable).
export default function TeamTab({ staffList, onAddStaff, onRemoveStaff, profile }) {
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [staffError, setStaffError] = useState('');

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
      .catch(() => { if (active) setPinConfigured(false); });
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
    if (!newUsername || !newPassword) return;
    if (newPassword.length < 12) {
      setStaffError('Password must be at least 12 characters with upper, lower, digit, and symbol');
      return;
    }
    try {
      await onAddStaff({ email: newUsername, password: newPassword, name: newStaffName || newUsername });
      setNewUsername('');
      setNewPassword('');
      setNewStaffName('');
    } catch {
      setStaffError('Failed to add staff. Check the email format or try a different password.');
    }
  };

  const inputClass = 'bg-gray-50 border border-gray-200/80 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:bg-white focus:border-gray-400';

  return (
    <>
      {/* Staff Management */}
      {staffList !== undefined && (
        <SettingsCard
          icon={Users}
          iconClass="bg-red-50 text-[#bf4a53]"
          title="Staff Management"
          desc="Create and manage staff accounts"
        >
          {staffError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium">
              <AlertCircle size={16} /> {staffError}
            </div>
          )}
          <form onSubmit={handleAddStaff} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3">
            <input type="text" placeholder="Name" value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)} className={inputClass} />
            <input type="text" placeholder="Username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className={inputClass} required />
            <input type="password" placeholder="Password (12+ chars)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} required minLength={12} />
            <button type="submit" className="bg-[#bf4a53] text-white px-5 py-3 rounded-full text-sm font-semibold hover:bg-red-700 transition-colors flex items-center justify-center gap-2 shadow-sm shadow-red-500/20">
              <Plus size={16} /> Add
            </button>
          </form>

          {staffList.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No staff accounts yet.</p>
          ) : (
            <div className="space-y-3">
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
        </SettingsCard>
      )}

      {/* Two-Factor Authentication */}
      <SettingsCard
        icon={Key}
        iconClass="bg-gray-900 text-white"
        title="Two-Factor Authentication"
        desc="Protect this admin account with a TOTP authenticator app"
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
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Scan the QR code below with your authenticator app (Google Authenticator, Authy, etc.),
              then enter the 6-digit code it generates.
            </p>
            <div className="flex items-center justify-center p-4 bg-gray-50 rounded-2xl">
              {mfaQrDataUri ? (
                <img src={mfaQrDataUri} alt="MFA QR Code" className="w-48 h-48 object-contain" />
              ) : (
                /* Fallback: show the typed-out setup key if the QR image is unavailable */
                <div className="text-center p-4">
                  <p className="text-xs text-gray-500 mb-2">QR unavailable — enter this key manually:</p>
                  <p className="font-mono text-sm font-semibold text-gray-900 break-all">{mfaSecret}</p>
                </div>
              )}
            </div>
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
              className="w-full px-4 py-3 bg-[#bf4a53] text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {mfaLoading ? 'Enabling...' : 'Enable MFA'}
            </button>
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
      </SettingsCard>

      {/* Discount Authorization PIN */}
      <SettingsCard
        icon={Lock}
        iconClass="bg-red-50 text-[#bf4a53]"
        title="Discount Authorization PIN"
        desc="Set a 4-digit PIN that staff enter to approve discounts on rentals"
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
      </SettingsCard>

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
