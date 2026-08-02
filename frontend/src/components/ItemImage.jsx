import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { storageService } from '../services/storage';

const isAbsoluteUrl = (p) =>
  typeof p === 'string' && (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:'));

export default function ItemImage({ image, alt = '', className = '', placeholderSize = 28 }) {
  const [src, setSrc] = useState(() => (image && isAbsoluteUrl(image) ? image : null));

  useEffect(() => {
    let active = true;
    if (!image || isAbsoluteUrl(image)) {
      setSrc(image || null);
      return;
    }
    storageService
      .getDownloadUrl(image)
      .then((res) => { if (active) setSrc(res?.url || null); })
      .catch(() => { if (active) setSrc(null); });
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
