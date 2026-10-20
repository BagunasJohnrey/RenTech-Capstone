import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Pencil, Check, X, Upload, Loader2 } from 'lucide-react';
import ItemImage from '../ItemImage';
import { settingsService } from '../../services/settings';
import { storageService } from '../../services';
import { fileToBase64, downscaleToJpeg } from '../../utils/file';
import { useToast } from '../Toast';

// Eyebrow title style shared by the sibling settings cards/groups.
const EYEBROW = 'text-xs font-bold text-gray-500 uppercase tracking-widest';

// Tolerant reader for the `manual_qr_codes` rule (JSON string).
function parseCodes(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Admin-only manager for the Manual QR gateway's codes. The list lives in the
// `manual_qr_codes` BusinessRule (JSON string) and is read/written through the
// same /settings/rules path the rest of the Integrations tab uses (admin + MFA
// enforced server-side; a bad payload 400s and is surfaced verbatim). Images
// upload to the public catalog bucket under `qrcodes/` (server normalizes them
// to WebP), so previews resolve with no signing round-trip.
export default function PaymentQrManager({ value, onChange }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [codes, setCodes] = useState(() => (Array.isArray(value) ? value : []));
  const [loading, setLoading] = useState(() => !Array.isArray(value));
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAccount, setEditAccount] = useState('');
  const [editPath, setEditPath] = useState('');
  const [editPreview, setEditPreview] = useState('');
  const [editUploading, setEditUploading] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newPreview, setNewPreview] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newAccount, setNewAccount] = useState('');
  const fileRef = useRef(null);
  const editFileRef = useRef(null);

  // IntegrationsTab doesn't carry manual_qr_codes, so the manager loads them
  // itself from GET /settings/rules (the same source it writes back to).
  useEffect(() => {
    if (Array.isArray(value)) return;
    let cancelled = false;
    settingsService.getRules()
      .then((rules) => { if (!cancelled) setCodes(parseCodes(rules?.manual_qr_codes)); })
      .catch(() => { /* keep [] — an admin can still add the first code */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (next) => {
    const prev = codes;
    setCodes(next);
    onChange?.(next);
    setSaving(true);
    try {
      await settingsService.updateRules({ manual_qr_codes: JSON.stringify(next) });
      toastSuccess('Payment QR codes saved.');
      return true;
    } catch (err) {
      setCodes(prev);
      onChange?.(prev);
      toastError(err?.message || 'Could not save payment QR codes.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const resetAdd = () => {
    setAddOpen(false);
    setUploading(false);
    setNewPath('');
    setNewPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return ''; });
    setNewLabel('');
    setNewAccount('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadQr(file, newLabel || file.name);
      setNewPath(path);
      setNewPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    } catch (err) {
      toastError(err?.message || 'QR image upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const uploadQr = async (file, label) => {
    // Downscale first (fast + HEIC-safe); fall back to raw base64 bytes.
    let base64;
    let contentType;
    const down = await downscaleToJpeg(file, 1280, 0.85);
    if (down) {
      base64 = down;
      contentType = 'image/jpeg';
    } else {
      base64 = await fileToBase64(file);
      contentType = file.type?.startsWith('image/') ? file.type : 'image/jpeg';
    }
    const slug = slugify(label || file.name) || 'qr';
    const key = `qrcodes/${slug}-${Date.now()}.jpg`;
    const { path } = await storageService.upload(key, contentType, base64);
    return path;
  };

  const handleEditFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setEditUploading(true);
    try {
      const path = await uploadQr(file, editLabel || file.name);
      setEditPath(path);
      setEditPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    } catch (err) {
      toastError(err?.message || 'QR image upload failed.');
    } finally {
      setEditUploading(false);
    }
  };

  const startEdit = (qr) => {
    setConfirmId(null);
    setEditingId(qr.id);
    setEditLabel(qr.label || '');
    setEditAccount(qr.accountName || '');
    setEditPath(qr.imagePath || '');
    setEditPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return ''; });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditUploading(false);
    setEditPath('');
    setEditPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return ''; });
    if (editFileRef.current) editFileRef.current.value = '';
  };

  const addCode = async () => {
    if (!newPath) { toastError('Upload a QR image first.'); return; }
    if (!newLabel.trim()) { toastError('Give this QR code a label.'); return; }
    const entry = {
      id: `qr-${Date.now()}`,
      label: newLabel.trim(),
      accountName: newAccount.trim(),
      imagePath: newPath,
    };
    if (await persist([...codes, entry])) resetAdd();
  };

  const saveEdit = async () => {
    if (!editLabel.trim()) { toastError('Label cannot be empty.'); return; }
    const next = codes.map((c) => (
      c.id === editingId
        ? { ...c, label: editLabel.trim(), accountName: editAccount.trim(), imagePath: editPath || c.imagePath }
        : c
    ));
    if (await persist(next)) cancelEdit();
  };

  const removeCode = async (id) => {
    if (await persist(codes.filter((c) => c.id !== id))) setConfirmId(null);
  };

  return (
    <div className="rounded-2xl bg-white border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className={EYEBROW}>Payment QR codes</h4>
          <p className="text-xs text-gray-500 mt-1">
            Customers scan one of these and upload a screenshot for staff review.
          </p>
        </div>
        {!addOpen && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={saving}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 min-h-[40px] rounded-full bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <Plus size={13} /> Add QR code
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 mt-3">Loading…</p>
      ) : (
        <div className="mt-3 space-y-2">
          {codes.length === 0 && !addOpen && (
            <p className="text-xs text-gray-400">No QR codes yet. Add one so customers can pay by scanning.</p>
          )}
          {codes.map((qr) => (
            <div key={qr.id} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50/70 border border-gray-100">
              <span className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-gray-200 shrink-0">
                {editingId === qr.id && editPreview ? (
                  <img src={editPreview} alt="QR preview" className="w-full h-full object-contain" />
                ) : (
                  <ItemImage
                    image={editingId === qr.id ? editPath : qr.imagePath}
                    thumb
                    alt={`${qr.label} QR code`}
                    className="w-full h-full object-contain"
                  />
                )}
              </span>
              {editingId === qr.id ? (
                <div className="flex-1 min-w-0 space-y-1.5">
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    maxLength={40}
                    placeholder="Label (e.g. GCash)"
                    className="w-full p-2 bg-white rounded-lg border border-gray-200 text-sm font-medium focus:outline-none focus:border-[#bf4a53]"
                  />
                  <input
                    value={editAccount}
                    onChange={(e) => setEditAccount(e.target.value)}
                    maxLength={60}
                    placeholder="Account name (optional)"
                    className="w-full p-2 bg-white rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-[#bf4a53]"
                  />
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 min-h-[32px] rounded-full bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer">
                    {editUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    Replace image
                    <input
                      ref={editFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleEditFile}
                      disabled={editUploading || saving}
                    />
                  </label>
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">{qr.label}</p>
                  <p className="text-xs text-gray-500 truncate">{qr.accountName || 'No account name'}</p>
                </div>
              )}
              <div className="shrink-0 flex items-center gap-1">
                {editingId === qr.id ? (
                  <>
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={saving || editUploading}
                      aria-label="Save QR code"
                      className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      aria-label="Cancel edit"
                      className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
                    >
                      <X size={15} />
                    </button>
                  </>
                ) : confirmId === qr.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => removeCode(qr.id)}
                      disabled={saving}
                      aria-label="Confirm delete"
                      className="text-[11px] font-bold px-3 py-2 min-h-[40px] rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      aria-label="Cancel delete"
                      className="text-[11px] font-bold px-3 py-2 min-h-[40px] rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startEdit(qr)}
                      aria-label={`Edit ${qr.label}`}
                      className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(qr.id)}
                      aria-label={`Delete ${qr.label}`}
                      className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-red-500 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <div className="mt-3 p-3 rounded-2xl bg-gray-50/70 border border-gray-100 space-y-2">
          <div className="flex items-center gap-3">
            <span className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-gray-200 flex items-center justify-center shrink-0">
              {newPreview
                ? <img src={newPreview} alt="QR preview" className="w-full h-full object-contain" />
                : <Upload size={16} className="text-gray-300" />}
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 min-h-[40px] rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer">
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {newPath ? 'Replace image' : 'Choose QR image'}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
                disabled={uploading}
              />
            </label>
            {newPath && <span className="text-[11px] text-emerald-600 font-bold">Uploaded</span>}
          </div>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            maxLength={40}
            placeholder="Label (e.g. GCash)"
            className="w-full p-2 bg-white rounded-lg border border-gray-200 text-sm font-medium focus:outline-none focus:border-[#bf4a53]"
          />
          <input
            value={newAccount}
            onChange={(e) => setNewAccount(e.target.value)}
            maxLength={60}
            placeholder="Account name (optional)"
            className="w-full p-2 bg-white rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-[#bf4a53]"
          />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={addCode}
              disabled={saving || uploading}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-full bg-[#bf4a53] text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add QR code
            </button>
            <button
              type="button"
              onClick={resetAdd}
              className="px-4 py-2 min-h-[40px] rounded-full border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
