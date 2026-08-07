import { useEffect, useRef, useState } from 'react';
import { X, Loader2, Camera, AlertTriangle, Keyboard, Package, Undo2, ArrowLeft } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { api } from '../utils/api';
import { useEscapeClose } from '../hooks/useEscapeClose';

// Camera QR scanner for staff. Before the camera opens, the staff member picks
// which process they're running — RELEASE (customer pickup) or RETURN — then
// scans the booking QR (`RT-XXXXXXXX`). Fetches the transaction via
// GET /transactions/scan/:code (staff only) and calls onFound(tx, action).
export default function QrScannerModal({ onFound, onClose, title = 'Scan booking QR' }) {
  useEscapeClose(onClose);
  const regionId = useRef(`qr-reader-${Math.random().toString(36).slice(2, 9)}`);
  const scannerRef = useRef(null);
  const runningRef = useRef(false);
  const actionRef = useRef(null);
  const [action, setAction] = useState(null); // null | 'release' | 'return'
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [videoAR, setVideoAR] = useState(null); // measured camera aspect ratio
  // Ref guard: the decode callback closure can't see state updates, so a
  // state-based check would let rapid repeat decodes fire duplicate lookups.
  const lookingUpRef = useRef(false);

  const stop = async () => {
    if (scannerRef.current && runningRef.current) {
      runningRef.current = false;
      try { await scannerRef.current.stop(); } catch { /* already stopped */ }
      try { await scannerRef.current.clear(); } catch { /* noop */ }
    }
  };

  const lookup = async (raw) => {
    if (lookingUpRef.current) return;
    const m = String(raw || '').match(/(?:tx=)?(RT-[0-9A-Fa-f]{6,8})/i);
    if (!m) {
      setLookupError('Not a RenTech booking QR. Expected a code like RT-XXXXXXXX.');
      return;
    }
    setLookupError('');
    lookingUpRef.current = true;
    setLookingUp(true);
    try {
      const tx = await api.get(`/transactions/scan/${encodeURIComponent(m[1].toUpperCase())}`);
      // Don't await stop() before handing off — stopping the stream can take
      // a beat (camera teardown) and it's not required for onFound. The
      // modal unmount cleanup will stop the camera anyway; the guard below
      // just prevents further decodes from firing while we're already found.
      lookingUpRef.current = false;
      try {
        runningRef.current = false;
        if (scannerRef.current) {
          scannerRef.current.stop().catch(() => {});
          scannerRef.current.clear().catch(() => {});
        }
      } catch { /* noop */ }
      onFound(tx, actionRef.current);
    } catch (err) {
      lookingUpRef.current = false;
      setLookingUp(false);
      setLookupError(err?.message || 'Booking not found for this QR code.');
    }
  };

  const start = async () => {
    setCameraError('');
    setLookupError('');
    try {
      const scanner = new Html5Qrcode(regionId.current);
      scannerRef.current = scanner;
      runningRef.current = true;
      setScanning(true);
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 30,
          qrbox: { width: 240, height: 240 },
          // Only decode QR codes (skip 1D barcodes) — cuts decode time a lot.
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          showTorchButtonIfSupported: true,
        },
        (decoded) => {
          // QR decoded — look it up (ref guard against rapid repeat decodes).
          if (!lookingUpRef.current) lookup(decoded);
        },
        () => {} // per-frame decode failures are normal; ignore
      );
      // Measure the live feed and fit the viewfinder to it (laptop webcams are
      // landscape, phones portrait) so no side gets cropped away.
      measureFrameSize();
    } catch {
      setCameraError('Camera unavailable or permission denied. Check the browser permission and HTTPS.');
      setScanning(false);
      runningRef.current = false;
    }
  };

  // Read the camera stream's native resolution off the <video> element and
  // adapt the viewfinder aspect ratio to it. Runs a few retries because
  // videoWidth/Height can still be 0 for a frame or two after start.
  const measureFrameSize = (attempt = 0) => {
    const el = document.getElementById(regionId.current);
    const video = el?.querySelector('video');
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoAR(`${video.videoWidth} / ${video.videoHeight}`);
      return;
    }
    if (attempt < 15) setTimeout(() => measureFrameSize(attempt + 1), 100);
  };

  const chooseAction = (next) => {
    actionRef.current = next;
    setAction(next);
    setLookupError('');
    setShowManual(false);
  };

  const backToProcess = async () => {
    await stop();
    actionRef.current = null;
    setAction(null);
    setScanning(false);
    setCameraError('');
    setLookupError('');
    setShowManual(false);
  };

  // Start the camera only AFTER the reader <div> has actually mounted — the
  // process-pick step renders it, so starting in the click handler ran before
  // React committed the element and Html5Qrcode mounted onto nothing, which
  // surfaced as a bogus "Camera unavailable or permission denied".
  useEffect(() => {
    if (!action) return;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  useEffect(() => {
    return () => { stop(); };
  }, []);

  return (
    <div className="fixed inset-0 z-[400] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Camera size={18} className="text-[#bf4a53]" /> {title}
          </h3>
          <button onClick={onClose} aria-label="Close scanner" className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {!action ? (
            <>
              <div className="text-center mb-2">
                <div className="inline-flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-full px-3.5 py-1.5 mb-3">
                  <Camera size={14} className="text-[#bf4a53]" />
                  <span className="text-[11px] font-bold text-gray-600">QR Scanner</span>
                </div>
                <h4 className="font-bold text-gray-900 text-lg leading-snug">What are you processing?</h4>
                <p className="text-xs text-gray-500 mt-1">Pick a process to start the camera.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => chooseAction('release')}
                  className="flex flex-col items-center gap-2.5 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 hover:border-blue-300 rounded-2xl p-5 font-bold text-blue-700 transition-all btn-press">
                  <span className="p-3 bg-white rounded-2xl shadow-sm">
                    <Package size={26} />
                  </span>
                  <span className="text-sm text-center leading-tight">
                    Release Item
                    <span className="block text-[10px] font-semibold text-blue-500 mt-0.5">Customer pickup</span>
                  </span>
                </button>
                <button
                  onClick={() => chooseAction('return')}
                  className="flex flex-col items-center gap-2.5 bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-200 hover:border-emerald-300 rounded-2xl p-5 font-bold text-emerald-700 transition-all btn-press">
                  <span className="p-3 bg-white rounded-2xl shadow-sm">
                    <Undo2 size={26} />
                  </span>
                  <span className="text-sm text-center leading-tight">
                    Return Item
                    <span className="block text-[10px] font-semibold text-emerald-500 mt-0.5">Process return</span>
                  </span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button onClick={backToProcess}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-[#bf4a53] px-1 py-0.5 transition-colors">
                  <ArrowLeft size={13} /> Change process
                </button>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                  action === 'release'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {action === 'release' ? 'Release Item' : 'Return Item'}
                </span>
              </div>

              <div className="relative rounded-3xl overflow-hidden bg-black ring-1 ring-black/5 shadow-[0_8px_30px_rgba(0,0,0,0.25)]" style={{ aspectRatio: videoAR || '3 / 4' }}>
                <div id={regionId.current} className="absolute inset-0 w-full h-full" />
                {!scanning && !cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
                    <Loader2 size={24} className="animate-spin" />
                    <p className="text-xs">Starting camera…</p>
                  </div>
                )}

                {/* Scan frame overlay */}
                {scanning && !cameraError && (
                  <>
                    {/* Ambient darkening — everything outside the target dims */}
                    <div className="absolute inset-0 bg-black/40" />
                    <div
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-52 h-52 rounded-3xl"
                      style={{ boxShadow: '0 0 0 4000px rgba(0,0,0,0.55)' }}
                    />
                    {/* Corner brackets */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-52 h-52">
                      <span className="absolute top-0 left-0 w-10 h-10 border-t-[3px] border-l-[3px] border-white/95 rounded-tl-2xl" />
                      <span className="absolute top-0 right-0 w-10 h-10 border-t-[3px] border-r-[3px] border-white/95 rounded-tr-2xl" />
                      <span className="absolute bottom-0 left-0 w-10 h-10 border-b-[3px] border-l-[3px] border-white/95 rounded-bl-2xl" />
                      <span className="absolute bottom-0 right-0 w-10 h-10 border-b-[3px] border-r-[3px] border-white/95 rounded-br-2xl" />
                      {/* Animated scan line */}
                      <span className="animate-scanline absolute left-2 right-2 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#ef5d68] to-transparent shadow-[0_0_18px_4px_rgba(239,93,104,0.55)]" />
                    </div>
                  </>
                )}

                {cameraError && !lookingUp && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-900/90 p-4 text-center">
                    <Camera size={26} className="text-gray-400" />
                    <p className="text-xs text-gray-300 font-semibold leading-relaxed">{cameraError}</p>
                  </div>
                )}
              </div>

              {lookingUp && (
                <p className="text-xs text-gray-500 flex items-center justify-center gap-2 py-2">
                  <Loader2 size={14} className="animate-spin" /> Looking up booking…
                </p>
              )}
              {lookupError && !lookingUp && (
                <div className="flex items-start gap-2 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {lookupError}
                </div>
              )}

              <div className="border-t border-gray-100 pt-3 space-y-2.5">
                <button onClick={() => setShowManual((s) => !s)}
                  className="w-full text-xs font-bold text-gray-500 hover:text-[#bf4a53] flex items-center justify-center gap-1.5 py-1.5 transition-colors">
                  <Keyboard size={14} /> {showManual ? 'Hide manual entry' : "Can't scan? Enter code manually"}
                </button>
                {showManual && (
                  <div className="flex gap-2">
                    <input
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                      placeholder="RT-XXXXXXXX"
                      className="flex-1 p-2.5 bg-gray-50 rounded-xl border text-sm font-mono focus:outline-none focus:border-[#bf4a53]"
                    />
                    <button
                      onClick={() => lookup(manualCode)}
                      disabled={!manualCode.trim() || lookingUp}
                      className="px-4 py-2.5 bg-[#bf4a53] text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-colors disabled:opacity-50">
                      Find
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}