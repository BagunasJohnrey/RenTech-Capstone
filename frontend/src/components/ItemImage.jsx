import { useEffect, useRef, useState, memo } from 'react';
import { ImageIcon } from 'lucide-react';
import {
  isAbsoluteUrl,
  isPrivatePath,
  thumbUrlFor,
  resolveDisplayUrl,
} from '../utils/images';

// Thumb keys proven dead this session (legacy objects with no generated
// thumb) — skip straight to the full image instead of 404ing every mount.
const deadThumbs = new Set();

function ItemImage({ image, alt = '', className = '', placeholderSize = 28, eager = false, thumb = false, onSettled }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(eager);
  const [src, setSrc] = useState(() => (image && isAbsoluteUrl(image) ? image : null));
  const [thumbFailed, setThumbFailed] = useState(false);
  // Settles exactly once per image: parent cards gate on this to hold the
  // whole card on a skeleton until the photo is in (or definitively failed).
  const settledRef = useRef(false);
  const settle = () => {
    if (!settledRef.current) {
      settledRef.current = true;
      onSettled?.();
    }
  };
  useEffect(() => { settledRef.current = false; }, [image]);

  const wantThumb = thumb && !isPrivatePath(image) && !thumbFailed && !deadThumbs.has(image);

  // Don't resolve anything (not even the signing request) until the image
  // is near the viewport. `eager` bypasses for above-the-fold content.
  useEffect(() => {
    if (eager || inView) return;
    if (typeof IntersectionObserver === 'undefined' || !ref.current) {
      setInView(true);
      return;
    }
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager, inView]);

  useEffect(() => {
    let active = true;
    setThumbFailed(false);
    if (!inView) return;
    if (!image || isAbsoluteUrl(image)) {
      setSrc(image || null);
      // No image at all: the placeholder IS the final state — settle now so
      // gating parents don't hold a skeleton forever. (Absolute URLs still
      // load async; their <img onLoad> settles them.)
      if (!image) settle();
      return;
    }
    // Grid thumbs: the small public webp first; onError below falls back to
    // the full image for legacy objects without a generated thumb.
    if (thumb && !isPrivatePath(image) && !deadThumbs.has(image)) {
      setSrc(thumbUrlFor(image));
      return;
    }
    resolveDisplayUrl(image).then((url) => { if (active) setSrc(url || null); });
    return () => { active = false; };
    // thumbFailed included: flipping it re-runs to the full-image branch.
  }, [image, inView, thumb, thumbFailed]);

  const handleError = () => {
    // Thumb 404 (legacy object) -> remember + fall back to full image once.
    // Anything else failing -> placeholder, which is final: settle the gate.
    if (wantThumb && src && src.includes('/thumbs/')) {
      deadThumbs.add(image);
      setThumbFailed(true);
    } else {
      setSrc(null);
      settle();
    }
  };

  if (!src) {
    return (
      <div ref={ref} className={`flex items-center justify-center text-gray-300 ${className}`}>
        <ImageIcon size={placeholderSize} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={eager ? 'high' : 'auto'}
      onLoad={settle}
      onError={handleError}
    />
  );
}

export default memo(ItemImage);
