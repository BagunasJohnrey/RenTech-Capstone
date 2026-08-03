import { useEffect, useState, memo } from 'react';
import { ImageIcon } from 'lucide-react';
import { storageService } from '../services/storage';
import { imageCache } from '../utils/imageCache';

const isAbsoluteUrl = (p) =>
  typeof p === 'string' && (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:'));

// Resolve an absolute URL immediately; a private-bucket path goes through the
// shared signed-URL cache so grids of items don't re-hit the backend (and
// images don't flicker) on every render/navigation.
const resolveUrl = (image) =>
  imageCache.resolve(image, async () => {
    const res = await storageService.getDownloadUrl(image);
    return res?.url || null;
  });

function ItemImage({ image, alt = '', className = '', placeholderSize = 28 }) {
  const [src, setSrc] = useState(() => (image && isAbsoluteUrl(image) ? image : null));

  useEffect(() => {
    let active = true;
    if (!image || isAbsoluteUrl(image)) {
      setSrc(image || null);
      return;
    }
    resolveUrl(image).then((url) => { if (active) setSrc(url || null); });
    return () => { active = false; };
  }, [image]);

  if (!src) {
    return (
      <div className={`flex items-center justify-center text-gray-300 ${className}`}>
        <ImageIcon size={placeholderSize} />
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} />;
}

export default memo(ItemImage);
