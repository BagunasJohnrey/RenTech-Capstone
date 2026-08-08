import { useEffect, useState } from 'react';
import { X, Camera } from 'lucide-react';
import { storageService } from '../services';
import { useToast } from './Toast';

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1566162200445-98319fdb5515?auto=format&fit=crop&q=80&w=400';

const isAbsoluteUrl = (p) =>
  typeof p === 'string' && (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:'));

// Must stay in sync with the item types used across the app (preferences,
// catalog filters, recommendations).
const ITEM_TYPES = ['Gown', 'Suit', 'Barong', 'Filipiniana', 'Costume'];

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
  showPhoto = false,
  showSale = false,
  onSubmit,
  onClose,
  maxWidth = 'max-w-sm',
}) {
  const { error: toastError } = useToast();
  const [name, setName] = useState(initial.name ?? '');
  const [price, setPrice] = useState(initial.price ?? '');
  const [status, setStatus] = useState(initial.status ?? 'Available');
  const [category, setCategory] = useState(initial.category ?? 'Gown');
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl.split(',')[1]);
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
      const base64 = (await downscaleImage(file)) || (await fileToBase64(file));
      const contentType = file.type.startsWith('image/') ? file.type : 'image/jpeg';
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !price) return;
    const values = { name, price: parseFloat(price), status };
    if (showCategory) values.category = category;
    if (showPhoto) {
      const img = imagePath && imagePath.startsWith('blob:') ? null : imagePath;
      // New upload wins; otherwise keep the item's current photo (or fall
      // back to the placeholder only when the item had no photo at all).
      values.image = img || initial.image || FALLBACK_IMAGE;
    }
    if (showSale) {
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
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-3xl shadow-2xl w-full ${maxWidth} overflow-hidden animate-in fade-in zoom-in-95 duration-300`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-6 border-b border-gray-100/80 bg-gray-50/50">
          <div>
            <h3 className="font-bold text-lg text-gray-900">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 font-medium mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:bg-gray-200 p-2 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Garment Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 transition-all"
              placeholder="e.g. Golden Sequin Gown"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Price (₱)</label>
            <input
              type="number"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 transition-all"
              placeholder="1500"
            />
          </div>

          {showCategory && (
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 transition-all cursor-pointer"
                >
                  {ITEM_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {showPhoto && (
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <Camera size={14} /> Photo
              </label>
              <div className="relative h-40 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden">
                {previewUrl ? (
                  <>
                    <img src={previewUrl} className="w-full h-full object-cover" alt="" />
                    <button type="button" onClick={() => { setPreviewUrl(''); setImagePath(''); }} className="absolute top-2 right-2 p-1.5 bg-[#bf4a53] text-white rounded-full shadow">
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <label className="cursor-pointer text-center p-4">
                    <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                    <Camera size={28} className="text-gray-400 mx-auto mb-1" />
                    <p className="text-xs font-bold text-gray-400 uppercase">
                      {uploading ? 'Uploading…' : 'Tap to upload photo'}
                    </p>
                  </label>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Current Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full bg-gray-50/50 border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:bg-white focus:border-gray-400 transition-all cursor-pointer"
            >
              {statusOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {showSale && (
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Discount %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={discountPct}
                      onChange={(e) => setDiscountPct(e.target.value)}
                      className="w-full bg-white border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:border-gray-400"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Sale Price ₱</label>
                    <input
                      type="number"
                      min="0"
                      value={salePrice}
                      onChange={(e) => setSalePrice(e.target.value)}
                      className="w-full bg-white border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:border-gray-400"
                      placeholder="optional"
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Sale Ends (optional)</label>
                    <input
                      type="date"
                      value={saleEndsAt}
                      onChange={(e) => setSaleEndsAt(e.target.value)}
                      className="w-full bg-white border border-gray-200/80 rounded-2xl px-4 py-3 text-[13px] font-medium focus:outline-none focus:border-gray-400"
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-gray-400">
                    Leave sale price empty to apply % off the regular price.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="pt-4 flex items-center justify-end gap-3 mt-4">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-[13px] font-bold text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={uploading} className="px-6 py-2.5 text-[13px] font-bold text-white bg-[#bf4a53] hover:bg-red-700 rounded-full shadow-sm shadow-red-500/20 transition-all flex items-center gap-2 disabled:opacity-50">
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
