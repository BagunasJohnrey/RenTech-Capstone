import { useEffect, useState } from 'react';
import { X, Camera, Shirt, Loader2 } from 'lucide-react';
import { storageService } from '../services';
import { useToast } from './Toast';
import { useButtonGuard } from '../hooks/useButtonGuard';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { OCCASIONS, OCCASIONS_BY_CATEGORY, normalizeOccasions } from '../utils/occasions';
import { COLORS, normalizeColors } from '../utils/colors';
import ColorSelect from './ColorSelect';

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1566162200445-98319fdb5515?auto=format&fit=crop&q=80&w=400';

const isAbsoluteUrl = (p) =>
  typeof p === 'string' && (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:'));

// Must stay in sync with the item types used across the app (preferences,
// catalog filters, recommendations). The backend accepts any non-empty
// category string, so staff can also type a custom one via "Custom…".
const ITEM_TYPES = ['Gown', 'Suit', 'Barong', 'Filipiniana', 'Costume'];
const CUSTOM_OPTION = '__custom__';

// Shared inventory item editor used for both "Add" and "Edit". Common fields
// (name / price / status + modal chrome) live here; callers toggle category
// and photo via props. Replaces the duplicated AddInventoryItemModal and
// EditItemModal.
export default function ItemForm({
  title,
  subtitle,
  initial = {},
  statusOptions = ['Available', 'Cleaning', 'OutOfService'],
  submitLabel = 'Save',
  showCategory = false,
  // Distinct categories already saved in inventory (passed from App) — custom
  // categories staff added before appear as regular options, so the dropdown
  // grows the more the boutique uses it.
  knownCategories = [],
  // Role-gated sale section: sale fields render ONLY when the caller both
  // passes showSale AND role is Admin. Backend 403s non-admin sale writes,
  // so the UI must never offer the fields to Staff even if a caller
  // forgets the showSale gate.
  role = '',
  showOccasions = false,
  showColors = false,
  // Distinct colors already saved in inventory (passed from App) — customs
  // staff typed before appear as regular chips, like knownCategories.
  knownColors = [],
  showPhoto = false,
  showSale = false,
  onSubmit,
  onClose,
  maxWidth = 'max-w-sm',
}) {
  const { error: toastError } = useToast();
  useEscapeClose(onClose);
  // Button guard: blocks double-submit on Add/Edit (duplicate items).
  const { guarding: submitting, guard: guardSubmit } = useButtonGuard();
  const [name, setName] = useState(initial.name ?? '');
  const [price, setPrice] = useState(initial.price ?? '');
  const [status, setStatus] = useState(initial.status ?? 'Available');
  // Saved customs (from inventory) join the presets in the dropdown.
  const savedExtras = [...new Set(
    (knownCategories || [])
      .map((c) => String(c ?? '').trim())
      .filter((c) => c && !ITEM_TYPES.includes(c))
  )].sort((a, b) => a.localeCompare(b));
  const categoryOptions = [...ITEM_TYPES, ...savedExtras];
  // A stored category outside the preset + saved lists (e.g. typed elsewhere)
  // opens the form in "Custom" mode with the value preserved.
  const [category, setCategory] = useState(() =>
    initial.category && !ITEM_TYPES.includes(initial.category) && !(knownCategories || []).includes(initial.category)
      ? CUSTOM_OPTION
      : (initial.category ?? 'Gown')
  );
  const [customCategory, setCustomCategory] = useState(() =>
    initial.category && !categoryOptions.includes(initial.category) ? initial.category : ''
  );
  const effectiveCategory = category === CUSTOM_OPTION ? customCategory.trim() : category;
  const [occasions, setOccasions] = useState(() => normalizeOccasions(initial.occasions));
  const [colors, setColors] = useState(() => normalizeColors(initial.colors));
  // Saved customs join the presets as chips. Custom entry is validated to
  // letters/spaces/hyphens (matches backend max-30) and deduped
  // case-insensitively so "sage" and "Sage" never become two tags.
  const savedColorExtras = [...new Set(
    (knownColors || [])
      .map((c) => String(c ?? '').trim().replace(/\s+/g, ' '))
      .filter((c) => c && !COLORS.some((p) => p.toLowerCase() === c.toLowerCase()))
  )].sort((a, b) => a.localeCompare(b));
  const colorOptions = [...COLORS, ...savedColorExtras];
  const [customColor, setCustomColor] = useState('');
  const [showCustomColor, setShowCustomColor] = useState(false);
  const addCustomColor = () => {
    const clean = String(customColor ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!clean || !/^[A-Za-z][A-Za-z\s-]*$/.test(clean)) {
      toastError('Use letters only for a custom color (e.g. Sage)');
      return;
    }
    if ([...colors, ...colorOptions].some((c) => c.toLowerCase() === clean.toLowerCase())) {
      toastError(`"${clean}" is already in the list`);
      return;
    }
    setColors((prev) => [...prev, clean]);
    setCustomColor('');
    setShowCustomColor(false);
  };
  const [imagePath, setImagePath] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [onSale, setOnSale] = useState(initial.onSale ?? false);
  const [discountPct, setDiscountPct] = useState(initial.discountPct ?? '');
  const [salePrice, setSalePrice] = useState(initial.salePrice ?? '');
  const [saleEndsAt, setSaleEndsAt] = useState(
    initial.saleEndsAt ? new Date(initial.saleEndsAt).toISOString().slice(0, 10) : ''
  );

  // When editing an item that already has a photo, show it as the preview so
  // staff can see the current picture before replacing it. Storage paths are
  // resolved to a signed URL (same resolution the rest of the app uses).
  useEffect(() => {
    if (!showPhoto || !initial.image) return;
    let active = true;
    if (isAbsoluteUrl(initial.image)) {
      setPreviewUrl(initial.image);
    } else {
      storageService
        .getDownloadUrl(initial.image)
        .then((res) => { if (active && res?.url) setPreviewUrl(res.url); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [showPhoto, initial.image]);

  // Downscale large photos client-side so the base64 payload stays small and
  // the upload clears the storage bucket size limit.
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Downscale large photos client-side so the base64 payload stays small and
  // the upload clears the storage bucket size limit. Prefers WebP output: the
  // server stores WebP and passes compliant WebP uploads through
  // byte-identical, so one high-quality generation replaces the old
  // JPEG-then-WebP double transcode (the main cause of soft-looking photos).
  // Falls back to JPEG on browsers without WebP canvas encoding.
  const downscaleImage = (file) =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const maxDim = 1280;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        let dataUrl = '';
        try {
          dataUrl = canvas.toDataURL('image/webp', 0.92);
        } catch {
          dataUrl = '';
        }
        // Browsers without WebP canvas encoding silently return PNG instead
        // of WebP — detect and fall back to JPEG rather than a bloated PNG.
        const webp = dataUrl.startsWith('data:image/webp');
        if (!webp) {
          try {
            dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          } catch {
            resolve(null);
            return;
          }
        }
        resolve({ base64: dataUrl.split(',')[1], webp });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });

  // Upload the file to Supabase Storage via a server-side signed upload.
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || file.type.startsWith('blob:')) return;
    setUploading(true);
    try {
      const downsized = await downscaleImage(file);
      const base64 = downsized?.base64 || (await fileToBase64(file));
      // Match the content type to what the canvas actually produced — a WebP
      // payload labeled image/jpeg would be rejected server-side, and a WebP
      // labeled correctly skips the server transcode (no second generation).
      const contentType = downsized
        ? (downsized.webp ? 'image/webp' : 'image/jpeg')
        : (file.type.startsWith('image/') ? file.type : 'image/jpeg');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      const { path } = await storageService.upload(
        `${Date.now()}-${safeName}`,
        contentType,
        base64
      );
      setImagePath(path);
      setPreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      toastError(err?.message || 'Image upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    guardSubmit(async () => {
      if (!name || !price) return;
    const values = { name: name.trim(), price: parseFloat(price), status };
    if (showCategory) {
      if (!effectiveCategory) {
        toastError('Please enter a custom category name');
        return;
      }
      values.category = effectiveCategory.slice(0, 40);
    }
    if (showOccasions) {
      values.occasions = occasions;
    }
    if (showColors) {
      values.colors = colors;
    }
    if (showPhoto) {
      const img = imagePath && imagePath.startsWith('blob:') ? null : imagePath;
      // New upload wins; otherwise keep the item's current photo (or fall
      // back to the placeholder only when the item had no photo at all).
      values.image = img || initial.image || FALLBACK_IMAGE;
    }
    if (showSale && role === 'Admin') {
      values.onSale = onSale;
      values.discountPct = discountPct === '' ? null : parseFloat(discountPct);
      values.salePrice = salePrice === '' ? null : parseFloat(salePrice);
      values.saleEndsAt = saleEndsAt ? new Date(saleEndsAt).toISOString() : null;
    }
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      toastError(err?.message || 'Failed to save item');
    }
    });
  };

  // Canonical modal input theme (mirrors SaleModal / CustomerEditModal):
  // white surface, brand focus ring — replaces the old gray-50 fill.
  const inputClass =
    'w-full bg-white border border-gray-200/80 rounded-2xl px-4 py-2.5 text-[13px] font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15 transition-all';
  const categoryDefaults = OCCASIONS_BY_CATEGORY[effectiveCategory] || [];

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center px-0 pt-10 pb-0 sm:p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full ${maxWidth} max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-200`} onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center gap-3 p-5 sm:p-6 border-b border-gray-100/80 rounded-t-3xl sm:rounded-t-3xl">
          <div className="w-10 h-10 rounded-2xl bg-[#bf4a53]/10 flex items-center justify-center shrink-0">
            <Shirt size={18} className="text-[#bf4a53]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 leading-tight truncate">{title}</h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{subtitle || 'Fill in the garment details below'}</p>
          </div>
          <button onClick={onClose} aria-label="Close editor" className="text-gray-400 hover:bg-gray-100 p-2 rounded-full transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain p-5 sm:p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Garment Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="e.g. Golden Sequin Gown"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Price (₱)</label>
              <input
                type="number"
                required
                min="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputClass}
                placeholder="1500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {showCategory && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                >
                  {categoryOptions.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                  <option value={CUSTOM_OPTION}>Custom…</option>
                </select>
              </div>
            )}
            <div className={`space-y-1.5 ${showCategory ? '' : 'col-span-2'}`}>
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Current Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={`${inputClass} cursor-pointer`}
              >
                {statusOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Custom category — full-width, larger field. Once saved, the value
              joins the dropdown above (and the catalog filters) automatically. */}
          {showCategory && category === CUSTOM_OPTION && (
            <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Custom category name</label>
              <input
                type="text"
                autoFocus
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                maxLength={40}
                placeholder="e.g. Kimono, Tuxedo, Debut Gown"
                aria-label="Custom category name"
                className="w-full bg-white border border-gray-200/80 rounded-2xl px-5 py-3.5 text-[15px] font-semibold text-gray-900 placeholder-gray-400 placeholder:font-medium focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15 transition-all"
              />
              <p className="text-[11px] text-gray-400">It will stay in the category list for next time.</p>
            </div>
          )}

          {showOccasions && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Fits occasions</label>
                {categoryDefaults.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOccasions(categoryDefaults)}
                    className="text-[10px] font-bold text-[#bf4a53] hover:underline"
                  >
                    Use {effectiveCategory || category} defaults
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {OCCASIONS.map((occ) => {
                  const active = occasions.includes(occ);
                  return (
                    <button
                      key={occ}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setOccasions((prev) => prev.includes(occ) ? prev.filter((o) => o !== occ) : [...prev, occ])}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                        active
                          ? 'bg-[#bf4a53] text-white border-[#bf4a53] shadow-sm'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {occ}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400">Tag every occasion this item fits — customers can filter and search by these tags.</p>
            </div>
          )}

          {showColors && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Colors</label>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowCustomColor((v) => !v)}
                    aria-expanded={showCustomColor}
                    className={`text-[10px] font-bold transition-colors hover:underline ${
                      showCustomColor ? 'text-[#bf4a53]' : 'text-gray-400 hover:text-[#bf4a53]'
                    }`}
                  >
                    + Custom color…
                  </button>
                  {colors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setColors([])}
                      className="text-[10px] font-bold text-[#bf4a53] hover:underline"
                    >
                      Clear colors
                    </button>
                  )}
                </div>
              </div>
              <ColorSelect
                options={colorOptions}
                selected={colors}
                onToggle={(color) => setColors((prev) => prev.some((c) => c.toLowerCase() === color.toLowerCase()) ? prev.filter((c) => c.toLowerCase() !== color.toLowerCase()) : [...prev, color])}
                onClear={() => setColors([])}
              />
              {showCustomColor && (
                <div className="flex gap-2 animate-in fade-in slide-in-from-top-1 duration-150">
                  <input
                    type="text"
                    autoFocus
                    value={customColor}
                    onChange={(e) => setCustomColor(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomColor(); } }}
                    maxLength={30}
                    placeholder="e.g. Sage, Lilac"
                    aria-label="Custom color name"
                    className="flex-1 bg-white border border-gray-200/80 rounded-2xl px-4 py-2 text-[13px] font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15 transition-all"
                  />
                  <button
                    type="button"
                    onClick={addCustomColor}
                    className="px-4 py-2 text-[13px] font-bold text-white bg-[#bf4a53] hover:bg-red-700 rounded-2xl transition-colors shrink-0"
                  >
                    Add
                  </button>
                </div>
              )}
              <p className="text-[10px] text-gray-400">Tag the item's colors — powers the Colors filter, search, and AI stylist matching. Never shown on cards.</p>
            </div>
          )}

          {showPhoto && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <Camera size={14} /> Photo
              </label>
              <div className="relative h-40 bg-gray-50/70 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden">
                {previewUrl ? (
                  <>
                    <img src={previewUrl} className="w-full h-full object-cover" alt="" />
                    <button type="button" onClick={() => { setPreviewUrl(''); setImagePath(''); }} aria-label="Remove photo" className="absolute top-2 right-2 p-1.5 bg-[#bf4a53] text-white rounded-full shadow hover:bg-red-700 transition-colors">
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <label className="cursor-pointer text-center p-4">
                    <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                    {uploading ? (
                      <Loader2 size={28} className="text-[#bf4a53] mx-auto mb-1 animate-spin" />
                    ) : (
                      <Camera size={28} className="text-gray-400 mx-auto mb-1" />
                    )}
                    <p className="text-xs font-bold text-gray-400 uppercase">
                      {uploading ? 'Uploading…' : 'Tap to upload photo'}
                    </p>
                  </label>
                )}
              </div>
            </div>
          )}

          {showSale && role === 'Admin' && (
            <div className="space-y-3 rounded-2xl border border-amber-200/70 bg-amber-50/40 p-4">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">On Sale (Admin)</span>
                <input
                  type="checkbox"
                  checked={onSale}
                  onChange={(e) => setOnSale(e.target.checked)}
                  className="h-4 w-4 accent-[#bf4a53]"
                />
              </label>
              {onSale && (
                <div className="grid grid-cols-2 gap-3 animate-in fade-in duration-150">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Discount %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={discountPct}
                      onChange={(e) => setDiscountPct(e.target.value)}
                      className={inputClass}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Sale Price ₱</label>
                    <input
                      type="number"
                      min="0"
                      value={salePrice}
                      onChange={(e) => setSalePrice(e.target.value)}
                      className={inputClass}
                      placeholder="optional"
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Sale Ends (optional)</label>
                    <input
                      type="date"
                      value={saleEndsAt}
                      onChange={(e) => setSaleEndsAt(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-gray-400">
                    Leave sale price empty to apply % off the regular price.
                  </p>
                </div>
              )}
            </div>
          )}

          </div>

          <div className="shrink-0 bg-white/95 backdrop-blur-md border-t border-gray-100/80 px-5 sm:px-6 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={onClose} className="py-3 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-2xl transition-colors border border-gray-200">
                Cancel
              </button>
              <button type="submit" disabled={uploading || submitting} className="py-3 text-sm font-bold text-white bg-[#bf4a53] hover:bg-red-700 active:scale-[0.98] rounded-2xl shadow-sm shadow-red-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                {(uploading || submitting) && <Loader2 size={15} className="animate-spin" />}
                {uploading ? 'Uploading…' : submitting ? 'Saving…' : submitLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
