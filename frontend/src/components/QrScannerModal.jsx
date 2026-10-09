import { useEffect, useRef, useState } from 'react';
import { X, Loader2, Camera, AlertTriangle, Keyboard, Package, Undo2, ArrowLeft, RotateCcw } from 'lucide-react';
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
  // Camera session generation: StrictMode double-mounts effects in dev (and a
  // process switch restarts the stream), so overlapping start() calls must not
  // fight over the camera/element — only the newest session stays live.
  const sessionRef = useRef(0);
  // Structured scan errors: title + what-happened + how to recover. `switchTo`
  // offers a one-tap flip to the other process when the code is valid but the
  // rental is in the wrong state for this one.
  // On any failure the camera is parked and the viewfinder hides — only the
  // notice + recovery buttons stay until staff retries.
  const [streamDown, setStreamDown] = useState(false);
  const videoEl = () => document.getElementById(regionId.current)?.querySelector('video');
  const fail = (title, message, switchTo = null) => {
    lookingUpRef.current = false;
    setLookingUp(false);
    setLookupError(switchTo ? { title, message, switchTo } : { title, message });
    stop();
    setStreamDown(true);
  };
  const retryScan = () => {
    setLookupError('');
    setStreamDown(false);
    start();
  };
  // Ref guard: the decode callback closure can't see state updates, so a
  // state-based check would let rapid repeat decodes fire duplicate lookups.
  const lookingUpRef = useRef(false);
  // Same-code cooldown: a held-still QR (valid or not) decodes every frame —
  // without this the same error/scan would hammer state + the API nonstop.
  const lastScan = useRef({ raw: '', at: 0 });

  const teardown = async () => {
    runningRef.current = false;
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch { /* already stopped */ }
      try { await scannerRef.current.clear(); } catch { /* noop */ }
      scannerRef.current = null;
    }
  };

  const stop = async () => {
    sessionRef.current += 1; // invalidate any in-flight start
    await teardown();
  };

  const lookup = async (raw) => {
    if (lookingUpRef.current) return;
    const now = Date.now();
    if (lastScan.current.raw === raw && now - lastScan.current.at < 3000) return;
    lastScan.current = { raw, at: now };
    // Freeze the frame the moment something decodes — the feed holds still
    // while the lookup runs; fail() resumes it, success hands off.
    try { videoEl()?.pause?.(); } catch { /* noop */ }
    const m = String(raw || '').match(/(?:tx=)?(RT-[0-9A-Fa-f]{6,8})/i);
    if (!m) {
      fail(
        'Invalid QR code',
        'This doesn\u2019t look like a RenTech booking QR (RT-XXXXXXXX). Aim at the booking code or enter it manually below.'
      );
      return;
    }
    setLookupError('');
    lookingUpRef.current = true;
    setLookingUp(true);
    try {
      const tx = await api.get(`/transactions/scan/${encodeURIComponent(m[1].toUpperCase())}`);
      // State gate: a scan must match the rental's actual state, or staff get
      // a clear reason instead of the wrong modal (or worse, a bad write).
      // RELEASE accepts upcoming holds only; RETURN accepts live rentals only.
      const status = tx?.status;
      const action = actionRef.current;
      const gateError =
        action === 'return' && status === 'Reserved'
          ? 'Not released yet — scan this code with Release Item at pickup first.'
          : action === 'return' && status === 'Returned'
            ? 'Already returned — nothing to process.'
            : action === 'return' && status === 'Cancelled'
              ? 'This booking was cancelled — nothing to return.'
              : action === 'release' && (status === 'Active' || status === 'Overdue')
                ? 'Already released — scan this code with Process Return instead.'
                : action === 'release' && status === 'Returned'
                  ? 'Already returned — this booking is closed.'
                  : action === 'release' && status === 'Cancelled'
                    ? 'This booking was cancelled — nothing to release.'
                    : null;
      if (gateError) {
        const other = action === 'return' ? 'release' : 'return';
        fail('Wrong process for this booking', gateError, other);
        return;
      }
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
      if (err?.status === 404) {
        fail(
          'Booking not found',
          'No booking matches this code. Check the receipt — the code may be mistyped or from another item.'
        );
      } else {
        fail('Lookup failed', err?.message || 'Could not look up this booking. Check your connection and try again.');
      }
    }
  };

  const start = async () => {
    const my = ++sessionRef.current;
    // Fully park any previous stream BEFORE negotiating a new one — two
    // live getUserMedia sessions on the same element is the flicker.
    await teardown();
    if (my !== sessionRef.current) return;
    setCameraError('');
    setLookupError('');
    try {
      const scanner = new Html5Qrcode(regionId.current);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 20,
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
      // A newer session (StrictMode remount / process switch) took over while
      // we awaited the camera — park this stream, the newer one wins.
      if (my !== sessionRef.current) {
        await teardown();
        return;
      }
      runningRef.current = true;
      setScanning(true);
    } catch {
      if (my !== sessionRef.current) return;
      setCameraError('Camera unavailable or permission denied. Check the browser permission and HTTPS.');
      setScanning(false);
      runningRef.current = false;
    }
  };

  const chooseAction = (next) => {
    actionRef.current = next;
    setAction(next);
    setLookupError('');
    setStreamDown(false);
    setShowManual(false);
  };

  // One-tap recovery from a "wrong process" error: stop the camera first
  // (starting a second Html5Qrcode on the same element breaks the stream),
  // then flip to the other process.
  const switchProcess = async (next) => {
    await stop();
    chooseAction(next);
  };

  const backToProcess = async () => {
    await stop();
    actionRef.current = null;
    setAction(null);
    setScanning(false);
    setCameraError('');
    setLookupError('');
    setStreamDown(false);
    setShowManual(false);
  };

  // Start the camera only AFTER the reader <div> has actually mounted — the
  // process-pick step renders it, so starting in the click handler ran before
  // React committed the element and Html5Qrcode mounted onto nothing, which
  // surfaced as a bogus "Camera unavailable or permission denied".
  // The cleanup stops the stream so StrictMode remounts / process switches
  // never leave two live sessions fighting over the camera (the flicker).
  useEffect(() => {
    if (!action) return;
    start();
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  useEffect(() => {
    return () => { stop(); };
  }, []);

  return (
    <>
      {/* Kill the library's own frame UI: its 4 border bars flash white ↔
          green on every detection waver (the flicker). Our overlay provides
          the dimming + corner frame instead. Video (and any button UI) is
          untouched — only injected plain divs are hidden. */}
      <style>{`.qr-host > div{display:none !important;}`}</style>
    <div className="fixed inset-0 z-[400] bg-gray-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-sm max-h-[92dvh] overflow-y-auto animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
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

              {/* Fixed-ratio viewfinder: the box never resizes mid-stream, so the
                  feed can't jump or flicker when the camera reports its size.
                  The library letterboxes inside (black bars, never a stretch).
                  Hidden after a failed scan — only the notice + retry stay. */}
              {!streamDown && (
              <div className="relative rounded-3xl overflow-hidden bg-black ring-1 ring-black/5 shadow-[0_8px_30px_rgba(0,0,0,0.25)] aspect-[3/4]">
                <div id={regionId.current} className="qr-host absolute inset-0 w-full h-full" />
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
              )}

              {lookingUp && (
                <p className="text-xs text-gray-500 flex items-center justify-center gap-2 py-2">
                  <Loader2 size={14} className="animate-spin" /> Looking up booking…
                </p>
              )}
              {lookupError && !lookingUp && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-red-500 text-white flex items-center justify-center shrink-0">
                      <AlertTriangle size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-extrabold text-red-700 text-sm">{lookupError.title || 'Scan failed'}</p>
                      <p className="text-xs font-medium text-red-600 leading-relaxed mt-0.5">{lookupError.message}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={retryScan}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-xl bg-[#bf4a53] text-white text-xs font-bold hover:bg-[#a63f47] active:scale-[0.99] transition-all"
                    >
                      <RotateCcw size={13} /> Retry scan
                    </button>
                    {lookupError.switchTo && (
                      <button
                        type="button"
                        onClick={() => switchProcess(lookupError.switchTo)}
                        className="inline-flex items-center justify-center px-3.5 py-2.5 min-h-[44px] rounded-xl bg-gray-900 text-white text-xs font-bold hover:bg-gray-700 active:scale-[0.99] transition-all"
                      >
                        Use {lookupError.switchTo === 'return' ? 'Process Return' : 'Release Item'}
                      </button>
                    )}
                  </div>
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
    </>
  );
}