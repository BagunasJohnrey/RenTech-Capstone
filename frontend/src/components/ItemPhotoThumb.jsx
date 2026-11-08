import { Shirt, Maximize2 } from 'lucide-react';
import ItemImage from './ItemImage';

// Small item photo that opens the full-size viewer on tap. Used in the
// transactions list + transaction sheet. Without a photo it renders a plain
// (non-clickable) placeholder tile so row layouts stay aligned.
export default function ItemPhotoThumb({ image, name, onOpen, className = 'w-10 h-10', iconSize = 16 }) {
  if (!image) {
    return (
      <div className={`${className} rounded-xl bg-gray-100 flex items-center justify-center shrink-0`} aria-hidden="true">
        <Shirt size={iconSize} className="text-gray-400" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={`View full photo of ${name || 'item'}`}
      title="View full photo"
      className={`${className} group/thumb relative rounded-xl overflow-hidden bg-gray-100 shrink-0 ring-1 ring-gray-200/80 hover:ring-[#bf4a53]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53] transition-shadow`}
    >
      <ItemImage thumb image={image} alt={name || 'Item photo'} className="w-full h-full object-cover" placeholderSize={iconSize} />
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/thumb:bg-black/35 transition-colors">
        <Maximize2 size={14} className="text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity" />
      </span>
    </button>
  );
}
