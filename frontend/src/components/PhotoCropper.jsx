import { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, Check, Move } from 'lucide-react';

// Circular photo cropper: drag to reposition, slider to zoom, live circular
// preview. No dependencies — plain canvas. Exports a 512px square JPEG
// (base64, no data: prefix) matching the avatar upload shape.
const VIEW = 280;
const OUT = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export default function PhotoCropper({ src, onCancel, onConfirm, onError }) {
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

  // Load the picked file. HEIC/unsupported files fail here → parent shows
  // the "try another file" error instead of a stuck modal.
  useEffect(() => {
    let alive = true;
    const im = new Image();
    im.onload = () => {
      if (!alive) return;
      setImg(im);
      setZoom(1);
      setOff({ x: 0, y: 0 });
    };
    im.onerror = () => { if (alive && onError) onError(); };
    im.src = src;
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Escape closes; backdrop click closes (handled on the overlay div).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && onCancel) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const base = img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1;
  const sizeAt = (z) => ({
    w: img ? img.naturalWidth * base * z : 0,
    h: img ? img.naturalHeight * base * z : 0,
  });
  const limAt = (z) => {
    const { w, h } = sizeAt(z);
    return { x: Math.max(0, (w - VIEW) / 2), y: Math.max(0, (h - VIEW) / 2) };
  };
  const clampOff = (o, z) => {
    const lim = limAt(z);
    return {
      x: Math.max(-lim.x, Math.min(lim.x, o.x)),
      y: Math.max(-lim.y, Math.min(lim.y, o.y)),
    };
  };

  // Paint cover-fit image + dimmed surround + white circle ring, every render.
  const { w: dw, h: dh } = sizeAt(zoom);
  const shown = clampOff(off, zoom);
  useEffect(() => {
    if (!img) return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = VIEW * dpr;
    c.height = VIEW * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.drawImage(img, VIEW / 2 - dw / 2 + shown.x, VIEW / 2 - dh / 2 + shown.y, dw, dh);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, VIEW, VIEW);
    ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
    ctx.beginPath();
    ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 2, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });

  const onPointerDown = (e) => {
    drag.current = { x: e.clientX - off.x, y: e.clientY - off.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setOff(clampOff({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }, zoom));
  };
  const endDrag = () => { drag.current = null; };

  const onZoom = (v) => {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));
    setZoom(z);
    setOff((o) => clampOff(o, z));
  };

  const confirm = () => {
    if (!img) return;
    try {
      const c = document.createElement('canvas');
      c.width = OUT;
      c.height = OUT;
      const ctx = c.getContext('2d');
      const k = OUT / VIEW;
      ctx.drawImage(
        img,
        (VIEW / 2 - dw / 2 + shown.x) * k,
        (VIEW / 2 - dh / 2 + shown.y) * k,
        dw * k,
        dh * k
      );
      onConfirm(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
    } catch {
      if (onError) onError();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget && onCancel) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Crop profile photo"
    >
      <div className="modal-enter w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <h3 className="font-bold text-gray-900 text-base">Crop photo</h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel cropping"
            className="w-9 h-9 inline-flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pt-2">
          <canvas
            ref={canvasRef}
            style={{ width: VIEW, height: VIEW }}
            className="mx-auto rounded-2xl overflow-hidden touch-none cursor-grab active:cursor-grabbing max-w-full"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={endDrag}
            onWheel={(e) => onZoom(zoom - Math.sign(e.deltaY) * 0.15)}
          />
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400 font-medium mt-2.5">
            <Move size={12} /> Drag to reposition · slide to zoom
          </p>
          <div className="flex items-center gap-3 mt-2">
            <ZoomIn size={15} className="text-gray-400 shrink-0" />
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => onZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="w-full accent-[#bf4a53] h-8 cursor-pointer"
            />
          </div>
        </div>

        <div className="flex gap-2 p-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 min-h-[44px] border border-gray-200 rounded-full text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!img}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-[#a63f47] transition-colors shadow-sm disabled:opacity-50"
          >
            <Check size={15} /> Use photo
          </button>
        </div>
      </div>
    </div>
  );
}
