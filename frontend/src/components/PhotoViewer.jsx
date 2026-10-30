import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import ItemImage from './ItemImage';

// Full-screen view of one photo from a small set (e.g. condition photos
// Before / After). `photos` = [{ image, label }]; `index` = which is open.
// Escape is left to the parent so it can close the topmost layer first;
// Left/Right arrows switch photos. Backdrop tap closes.
export default function PhotoViewer({ photos, index, onIndexChange, onClose }) {
  const photo = photos[index];
  const many = photos.length > 1;

  useEffect(() => {
    if (!many) return;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') onIndexChange((index - 1 + photos.length) % photos.length);
      if (e.key === 'ArrowRight') onIndexChange((index + 1) % photos.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [many, index, photos.length, onIndexChange]);

  if (!photo) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`${photo.label} photo`}
      className="fixed inset-0 z-[10000] bg-black/90 flex flex-col animate-in fade-in duration-150"
      onClick={onClose}>
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        {many ? (
          <div className="inline-flex p-1 rounded-full bg-white/10" role="tablist" aria-label="Photos">
            {photos.map((p, i) => (
              <button key={p.label} type="button" role="tab" aria-selected={i === index}
                onClick={() => onIndexChange(i)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-bold transition-colors ${i === index ? 'bg-white text-gray-900' : 'text-white/80 hover:text-white'}`}>
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm font-bold">{photo.label}</p>
        )}
        <button type="button" onClick={onClose} aria-label="Close photo"
          className="w-10 h-10 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <X size={22} />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* key: remount per photo so a slow load never shows the other one */}
        <div onClick={(e) => e.stopPropagation()} className="max-w-full max-h-full flex">
          <ItemImage key={photo.image} eager image={photo.image} alt={`${photo.label} full size`}
            className="max-w-full max-h-[calc(100dvh-7rem)] object-contain rounded-xl" placeholderSize={36} />
        </div>
        {many && (
          <>
            <button type="button" aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + photos.length) % photos.length); }}
              className="absolute left-2 sm:left-4 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
              <ChevronLeft size={22} />
            </button>
            <button type="button" aria-label="Next photo"
              onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % photos.length); }}
              className="absolute right-2 sm:right-4 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
