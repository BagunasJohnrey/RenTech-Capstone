import { useState } from 'react';
import { Users, Plus, Trash2, AlertCircle, Key, ShieldCheck } from 'lucide-react';
import { api } from '../../utils/api';
import SettingsCard from './SettingsCard';

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
    </>
  );
}
