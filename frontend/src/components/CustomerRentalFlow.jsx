import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Smartphone, CreditCard, Search, Loader2, CheckCircle2, Check, ScanLine, Calendar, ChevronRight, ChevronDown, Download, SlidersHorizontal } from 'lucide-react';
import { usePromo } from '../hooks/usePromo';
import { usePayments } from '../hooks/usePayments';
import { usePaymongo } from '../hooks/usePaymongo';
import ItemImage from './ItemImage';
import { getSaleInfo } from './ItemCard';
import { inventoryService } from '../services/inventory';
import BookingCalendar from './BookingCalendar';
import Field from './ui/Field';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useToast } from './Toast';
import { SIZE_PRESETS } from '../utils/sizePresets';
import BookingQR from './BookingQR';
import QRCode from 'qrcode';
import { getBookingCode, txDownpayment, txBalance } from '../utils/receipt';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { api } from '../utils/api';

// Short booking code for the QR/receipt.
const bookingCode = (tx) => getBookingCode(tx);

const ITEMS_PER_LOAD = 6;

// Customer-saved "usual sizes" (Settings) — used to prefill the booking size.
const LS_SIZES = 'rentech_pref_sizes';

// Parses "Bust 34 / Waist 27" style free-text into the measurement field keys.
function parseStyleNotesToMeasurements(text, keys) {
  if (!text) return {};
  const out = {};
  for (const key of keys) {
    const label = key.replace(/([A-Z])/g, ' $1').trim().replace(/\s+/g, '\\s+');
    const re = new RegExp(`${label}[^\\d]*([\\d.]+)`, 'i');
    const m = text.match(re);
    if (m) out[key] = m[1];
  }
  return out;
}

export default function CustomerRentalFlow({
  item: preselectedItem,
  selectedDate: preselectedDate,
  inventory,
  customerInfo,
  onClose,
  onSubmitBooking,
  onCancelBooking,
  inline,
}) {
  useEscapeClose(onClose);
  const [step, setStep] = useState(() => (preselectedItem ? 1 : 0));
  const [selectedItem, setSelectedItem] = useState(preselectedItem || null);
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [rentalDate, setRentalDate] = useState(preselectedDate || todayStr);
  const measurementFields = useMemo(() => {
    const isFemale = selectedItem?.category?.toLowerCase().includes('gown');
    return isFemale
      ? ['bust', 'waist', 'hips', 'shoulderToFloor', 'shoulderWidth']
      : ['shoulder', 'chest', 'waist', 'sleeveLength', 'pantsLength', 'neck'];
  }, [selectedItem]);

  const [eventDate, setEventDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  });
  const eventDateTouched = useRef(false);
  // Suggested rental period + minimum downpayment come from the admin's
  // business rules (public endpoint) — fall back to the 3-day / ₱200 defaults.
  const [rentalDefaults, setRentalDefaults] = useState({ rental_period_days: 3, min_downpayment: 200 });
  useEffect(() => {
    let cancelled = false;
    api.get('/settings/rental-defaults')
      .then((d) => {
        if (cancelled || !d || typeof d.rental_period_days !== 'number') return;
        setRentalDefaults({ rental_period_days: d.rental_period_days, min_downpayment: d.min_downpayment || 0 });
        if (!eventDateTouched.current) {
          const dt = new Date();
          dt.setDate(dt.getDate() + d.rental_period_days);
          setEventDate(dt.toISOString().split('T')[0]);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const dueDate = useMemo(() => {
    if (!eventDate) return '';
    const d = new Date(eventDate);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, [eventDate]);
  const [useAccountDetails, setUseAccountDetails] = useState(true);
  const [customer, setCustomer] = useState({
    name: customerInfo?.name || '',
    contact: customerInfo?.contact || '',
    address: customerInfo?.address || '',
    notes: '',
  });
  const [paymentMethod, setPaymentMethod] = useState('gcash');
  // Prefill size from the customer's saved "usual sizes" (Settings) when available.
  const savedSizes = useMemo(() => {
    try { const v = JSON.parse(localStorage.getItem(LS_SIZES)); return Array.isArray(v) ? v : []; } catch { return []; }
  }, []);
  const [selectedSize, setSelectedSize] = useState(() => savedSizes[0] || '');
  const [measurementsExpanded, setMeasurementsExpanded] = useState(false);
  const [measurements, setMeasurements] = useState({});
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const saleInfo = selectedItem ? getSaleInfo(selectedItem) : null;
  const effectiveItemPrice = saleInfo?.active ? saleInfo.price : (selectedItem?.price || 0);
  // The flat minimum applies to the actual fee being charged (finalFee,
  // after any promo). Same as the server's requireMinimumDownpayment rule so
  // promo-discounted bookings can't be blocked by an over-large minimum.
  // Prefilled with the flat floor once an item is picked (step 0 resets it).
  const [downpaymentAmount, setDownpaymentAmount] = useState(0);
  const [confirmedTx, setConfirmedTx] = useState(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(null);
  const [promoError, setPromoError] = useState('');
  const [promoApplying, setPromoApplying] = useState(false);
  const [showQRDetails, setShowQRDetails] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // Catalog category filter — multi-select (empty = All), same collapsible
  // dropdown design as the staff rental flow.
  const [selectedCategories, setSelectedCategories] = useState([]);
  const toggleCategory = (key) => {
    setSelectedCategories(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };
  const [catOpen, setCatOpen] = useState(false);
  const catFilterRef = useRef(null);
  useEffect(() => {
    if (!catOpen) return;
    const onPointerDown = (e) => { if (catFilterRef.current && !catFilterRef.current.contains(e.target)) setCatOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setCatOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKey); };
  }, [catOpen]);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_LOAD);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [availability, setAvailability] = useState({ checking: false, available: null, reason: '' });
  const [bookedRanges, setBookedRanges] = useState([]);
  const [itemStatus, setItemStatus] = useState(null);
  const isCleaning = itemStatus === 'Cleaning' || selectedItem?.status === 'Cleaning';
  const catalogRef = useRef(null);

  const { validate: validatePromo } = usePromo();
  const { createIntent } = usePayments();
  const { openDropIn } = usePaymongo();
  const { info: toastInfo } = useToast();

  const clearFieldError = (field) => {
    setFieldErrors(prev => ({ ...prev, [field]: '' }));
  };

  const validateStep1 = () => {
    const errs = {};
    if (!selectedItem) errs.item = 'Please select an item.';
    if (!customer.name || customer.name.trim().length < 2) errs.name = 'Full name is required (min 2 characters)';
    if (!customer.contact || !/^\d{11}$/.test(customer.contact.trim())) errs.contact = 'Contact number must be exactly 11 digits';
    if (!customer.address || customer.address.trim().length < 5) errs.address = 'Address is required (min 5 characters)';
    if (new Date(rentalDate) < new Date(todayStr)) errs.rentalDate = 'Pickup date cannot be in the past';
    if (!eventDate) errs.eventDate = 'Please select an event date.';
    else if (new Date(eventDate) < new Date(rentalDate)) errs.eventDate = 'Event date must be on or after the pickup date';
    if (!selectedSize) errs.size = 'Please select a size';
    if (selectedSize === 'Custom / Measurements' && measurementsExpanded) {
      const filled = measurementFields.filter(f => measurements[f] && String(measurements[f]).trim());
      if (filled.length < 3) errs.measurements = 'Please provide at least 3 measurements';
    }
    if (downpaymentAmount < minDownpayment) errs.downpayment = `Downpayment must be at least ₱${minDownpayment.toLocaleString()}`;
    if (availability.available === false) errs.availability = availability.reason || 'Item is not available for the selected dates.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Category options built from the bookable inventory so every category
  // always appears — no hardcoded list to go stale.
  const catalogCategories = useMemo(() => {
    const seen = [];
    for (const item of inventory) {
      if (item.status === 'Deleted' || item.status === 'OutOfService') continue;
      const label = item.category || 'Other';
      if (!seen.some(c => c.key === label.toLowerCase())) seen.push({ key: label.toLowerCase(), label });
    }
    return seen;
  }, [inventory]);

  const filteredCatalog = useMemo(() => {
    return inventory.filter((item) => {
      // Hide items that can never be booked; show everything else (including
      // currently Rented/Reserved) so customers can reserve future-free dates.
      if (item.status === 'OutOfService' || item.status === 'Deleted') return false;
      const matchesCat = selectedCategories.length === 0 || selectedCategories.includes((item.category || '').toLowerCase());
      const q = searchQuery.trim().toLowerCase();
      const tags = Array.isArray(item.occasions) ? item.occasions : [];
      const matchesSearch = !q
        || item.name.toLowerCase().includes(q)
        || (item.category || '').toLowerCase().includes(q)
        || tags.some((t) => String(t).toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  }, [inventory, selectedCategories, searchQuery]);

  useEffect(() => { setVisibleCount(ITEMS_PER_LOAD); setLoadingMore(false); }, [selectedCategories, searchQuery]);

  // Live availability check against the backend (same overlap logic as createRental).
  // Lets customers reserve an item that is currently Rented but free for their dates.
  useEffect(() => {
    if (!selectedItem || !rentalDate || !dueDate) {
      setAvailability({ checking: false, available: null, reason: '' });
      return;
    }
    let active = true;
    setAvailability({ checking: true, available: null, reason: '' });
    inventoryService
      .availability(selectedItem.id, rentalDate, dueDate)
      .then((res) => { if (active) setAvailability({ checking: false, available: res.available, reason: res.reason || '' }); })
      .catch(() => { if (active) setAvailability({ checking: false, available: null, reason: '' }); });
    return () => { active = false; };
  }, [selectedItem, rentalDate, dueDate]);

  // Fetch the item's existing bookings so the calendar can mark blocked dates.
  useEffect(() => {
    if (!selectedItem) {
      setBookedRanges([]);
      return;
    }
    let active = true;
    inventoryService
      .blockedDates(selectedItem.id)
      .then((res) => { if (active) { setBookedRanges(res.blockedRanges || []); setItemStatus(res.itemStatus || null); } })
      .catch(() => { if (active) { setBookedRanges([]); setItemStatus(null); } });
    return () => { active = false; };
  }, [selectedItem]);

  const displayedItems = filteredCatalog.slice(0, visibleCount);
  const allLoaded = visibleCount >= filteredCatalog.length;

  const handleCatalogScroll = useCallback(() => {
    const el = catalogRef.current;
    if (!el || loadingMore || allLoaded) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setLoadingMore(true);
      setTimeout(() => {
        setVisibleCount((prev) => Math.min(prev + ITEMS_PER_LOAD, filteredCatalog.length));
        setLoadingMore(false);
      }, 400);
    }
  }, [loadingMore, allLoaded, filteredCatalog.length]);

  const toggleAccountDetails = (useAccount) => {
    setUseAccountDetails(useAccount);
    if (useAccount) {
      setCustomer({
        name: customerInfo?.name || '',
        contact: customerInfo?.contact || '',
        address: customerInfo?.address || '',
        notes: customer.notes,
      });
    } else {
      setCustomer({ name: '', contact: '', address: '', notes: customer.notes });
    }
  };

  const formatDate = (d) => new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric',
  });

  // FIX B: the price actually charged is the promo-discounted fee.
  const finalFee = promoApplied?.finalFee ?? effectiveItemPrice ?? 0;
  // Flat minimum downpayment from admin config — no 50% requirement.
  const minDownpayment = selectedItem
    ? Math.min(rentalDefaults.min_downpayment || 200, finalFee)
    : 0;

  // Build the booking payload sent to POST /bookings.
  // SECURITY: rentalFee is intentionally NOT sent — the server derives the
  // fee from the item (sale-aware) and enforces the min downpayment itself.
  const buildBookingData = () => ({
    itemId: selectedItem.id,
    rentalDate,
    dueDate,
    downpayment: Number(downpaymentAmount),
    notes: customer.notes,
    promoCode: promoApplied?.code || undefined,
    size: selectedSize || undefined,
    measurements: Object.keys(measurements).length ? measurements : undefined,
    paymentMethod,
  });

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoApplying(true);
    setPromoError('');
    try {
      const result = await validatePromo(promoCode.trim(), effectiveItemPrice || 0);
      setPromoApplied(result);
      setPromoError('');
    } catch (err) {
      setPromoApplied(null);
      setPromoError(err.message || 'Invalid promo code');
    }
    setPromoApplying(false);
  };

  const handleBack = () => {
    if (step > 1) setStep(s => s - 1);
    else onClose();
  };

  const handleNext = async () => {
    if (step === 0) {
      if (!selectedItem) { setFieldErrors({ item: 'Please select an item.' }); return; }
      setDownpaymentAmount(rentalDefaults.min_downpayment || 200);
      setFieldErrors({});
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!validateStep1()) return;
      setFieldErrors({});
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!validateStep1()) return;
      setIsProcessingPayment(true);
      setConfirmError('');
      try {
        // Create the booking first so we have a real transaction id.
        const created = await onSubmitBooking(buildBookingData());
        // FIX A: create a real PayMongo payment intent, then open the drop-in UI.
        // Transient failures (server cold start / network blip) get ONE retry
        // before we give up — rolling back a committed booking over a hiccup
        // is what made "Confirm Payment" glitch until a refresh fixed it.
        let intent;
        try {
          intent = await createIntent({ transactionId: created.id, amount: Number(downpaymentAmount) });
        } catch (payErr) {
          const transient = !payErr?.status || payErr?.status >= 500 || payErr?.name === 'TimeoutError';
          if (transient) {
            try {
              await new Promise((r) => setTimeout(r, 1200));
              intent = await createIntent({ transactionId: created.id, amount: Number(downpaymentAmount) });
            } catch (retryErr) {
              setConfirmError(retryErr?.message || payErr?.message || 'Payment failed. Please try again.');
              if (onCancelBooking) await onCancelBooking(created);
              return;
            }
          } else {
            // Definitive rejection (403/400/…): retrying can't help.
            setConfirmError(payErr?.message || 'Payment failed. Please try again.');
            // Roll back the committed booking so we don't leave an orphaned rental.
            if (onCancelBooking) await onCancelBooking(created);
            return;
          }
        }
        // No real gateway configured yet: simulate a successful payment so the
        // booking can complete end-to-end. When PAYMONGO_SECRET_KEY is set, the
        // backend returns a real intent and we open the PayMongo drop-in instead.
        if (intent.simulated) {
          toastInfo('Payment gateway not configured — simulating successful payment.');
          setPaymentSuccess(true);
          setConfirmedTx(created);
          setTimeout(() => {
            setPaymentSuccess(false);
            setStep(3);
          }, 1500);
          return;
        }
        try {
          await openDropIn(intent.clientKey, {
            amount: Number(downpaymentAmount) * 100,
            currency: 'PHP',
            description: `Rental downpayment for ${selectedItem?.name || 'item'}`,
          });
        } catch (payErr) {
          setConfirmError(payErr?.message || 'Payment was cancelled or failed.');
          if (onCancelBooking) await onCancelBooking(created);
          return;
        }
        setPaymentSuccess(true);
        setConfirmedTx(created);
        setTimeout(() => {
          setPaymentSuccess(false);
          setStep(3);
        }, 1500);
      } catch (err) {
        setConfirmError(err?.message || 'Booking failed. Please try again.');
      } finally {
        setIsProcessingPayment(false);
      }
    }
  };

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    // Booking was already created during the payment step; just close.
    onClose();
    setConfirming(false);
  };
  const handleQRTap = () => { if (confirmedTx) setShowQRDetails(true); };
  // Downloads the confirmed booking as a PNG receipt image styled like the
  // system branding (Plus Jakarta Sans, burgundy gradient letterhead, app
  // logo, RENTECH. wordmark). Drawn on canvas — no new dependencies and
  // works on mobile browsers.
  const handleSaveReceipt = async () => {
    if (!confirmedTx) return;
    try { await document.fonts?.ready; } catch { /* fall back to Arial */ }
    const loadImage = (src, timeoutMs = 2500) => new Promise((resolve) => {
      const img = new Image();
      const done = (v) => resolve(v);
      const timer = setTimeout(() => done(null), timeoutMs);
      img.onload = () => { clearTimeout(timer); done(img); };
      img.onerror = () => { clearTimeout(timer); done(null); };
      img.src = src;
    });
    const logo = await loadImage('/pwa-192x192.png');
    // QR only when the feature flag is on: reuse the already-rendered QR
    // data URI when ready, otherwise generate it (same qrcode lib as
    // BookingQR) so the saved image stays scannable.
    let qrImg = null;
    if (flags.qr_codes) {
      let qrUrl = qrSaveUrl || confirmedTx.qrCodeDataUri || null;
      if (!qrUrl) {
        try { qrUrl = await QRCode.toDataURL(code, { width: 368, margin: 1, errorCorrectionLevel: 'M' }); } catch { qrUrl = null; }
      }
      if (qrUrl) qrImg = await loadImage(qrUrl);
    }
    const peso = (n) => `₱${Number(n || 0).toLocaleString()}`;
    const code = bookingCode(confirmedTx);
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const F = (w, s, mono) => `${w} ${s}px ${mono ? '"Plus Jakarta Sans", monospace, Arial' : '"Plus Jakarta Sans", Arial, sans-serif'}`;
    const rows = [
      ['Item', selectedItem?.name || confirmedTx.item?.name || '—', 'bold'],
      ['Pickup', formatDate(rentalDate), ''],
      ['Event Date', formatDate(eventDate), 'bold'],
      ['Return By', formatDate(dueDate), 'accent'],
      ['Customer', confirmedTx.customer?.name || customer.name, 'bold'],
      ['Size', confirmedTx.size, ''],
    ];
    const S = 2, W = 600, M = 24, PAD = 28, LH = 28;
    const cardX = M, cardW = W - M * 2;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const rr = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    const wrap = (text, font, maxW) => {
      ctx.font = font;
      const words = String(text ?? '—').split(' ');
      const lines = [];
      let line = '';
      for (const w of words) {
        const t = line ? `${line} ${w}` : w;
        if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
        else line = t;
      }
      if (line) lines.push(line);
      return lines;
    };
    const labelW = 150, gap = 16, valW = cardW - PAD * 2 - labelW - gap;
    const measured = rows.map(([k, v, style]) => ({ k, style, lines: wrap(v, F(800, 19), valW) }));
    const headerH = 178;
    const rowsH = measured.reduce((h, r) => h + Math.max(r.lines.length, 1) * LH + 26, 0);
    const qrH = qrImg ? 216 + 24 : 0;
    const H = M + headerH + 30 + 64 + 30 + 24 + 30 + rowsH + 20 + 108 + 30 + qrH + 44 + 30 + 60 + M;
    cv.width = W * S;
    cv.height = H * S;
    ctx.scale(S, S);
    // Page backdrop
    ctx.fillStyle = '#fcfcfd';
    ctx.fillRect(0, 0, W, H);
    const cardY = M, cardH = H - M * 2;
    // Card base
    rr(cardX, cardY, cardW, cardH, 28);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#f1f2f4';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Gradient letterhead clipped to the card's top corners
    ctx.save();
    rr(cardX, cardY, cardW, cardH, 28);
    ctx.clip();
    const grad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
    grad.addColorStop(0, '#8e323a');
    grad.addColorStop(0.5, '#a63f47');
    grad.addColorStop(1, '#bf4a53');
    ctx.fillStyle = grad;
    ctx.fillRect(cardX, cardY, cardW, headerH);
    ctx.restore();
    const hx = cardX + PAD, hy = cardY + 36;
    // Logo in a white ring
    if (logo) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(hx + 32, hy + 32, 32, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.clip();
      ctx.drawImage(logo, hx, hy, 64, 64);
      ctx.restore();
    }
    const tx0 = hx + (logo ? 80 : 0);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = F(800, 27);
    ctx.fillText("Mylene's Boutique", tx0, hy + 26);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = F(500, 16);
    ctx.fillText('Rental Attire & Formal Wear', tx0, hy + 50);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('Balayan, Batangas, Philippines', tx0, hy + 70);
    // Receipt meta, right-aligned
    ctx.textAlign = 'right';
    const rx = cardX + cardW - PAD;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = F(800, 14);
    ctx.fillText('BOOKING RECEIPT', rx, hy + 8);
    ctx.fillStyle = '#ffffff';
    ctx.font = F(800, 22, true);
    ctx.fillText(code, rx, hy + 36);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = F(500, 14);
    ctx.fillText(today, rx, hy + 58);
    // Confirmed title with emerald check badge
    let y = cardY + headerH + 30;
    const cy = y + 22;
    ctx.beginPath();
    ctx.arc(cardX + PAD + 26, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#ecfdf5';
    ctx.fill();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cardX + PAD + 14, cy + 1);
    ctx.lineTo(cardX + PAD + 23, cy + 10);
    ctx.lineTo(cardX + PAD + 39, cy - 9);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#111827';
    ctx.font = F(800, 29);
    ctx.fillText('Booking Confirmed!', cardX + PAD + 64, y + 24);
    ctx.fillStyle = '#6b7280';
    ctx.font = F(500, 17);
    ctx.fillText('Your reservation has been secured.', cardX + PAD + 64, y + 50);
    y += 64 + 30;
    // Section label with burgundy rule
    ctx.fillStyle = '#bf4a53';
    ctx.fillRect(cardX + PAD, y, 4, 18);
    ctx.fillStyle = '#6b7280';
    ctx.font = F(800, 13);
    ctx.fillText('R E S E R V A T I O N   D E T A I L S', cardX + PAD + 12, y + 14);
    y += 30;
    // Detail rows with hairline dividers (values wrap, never crop)
    for (const r of measured) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(cardX + PAD, y, cardW - PAD * 2, 1);
      y += 13;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#6b7280';
      ctx.font = F(500, 18);
      ctx.fillText(r.k, cardX + PAD, y + 20);
      ctx.textAlign = 'right';
      ctx.font = F(800, 19);
      ctx.fillStyle = r.style === 'accent' ? '#bf4a53' : '#111827';
      r.lines.forEach((ln, i) => ctx.fillText(ln, cardX + cardW - PAD, y + 20 + i * LH));
      y += Math.max(r.lines.length, 1) * LH + 13;
    }
    y += 20;
    // Totals band
    const boxH = 108;
    rr(cardX + PAD, y, cardW - PAD * 2, boxH, 16);
    ctx.fillStyle = '#fdf2f3';
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6b7280';
    ctx.font = F(600, 18);
    ctx.fillText('Downpayment', cardX + PAD + 18, y + 40);
    ctx.fillText('Balance', cardX + PAD + 18, y + 76);
    ctx.textAlign = 'right';
    ctx.font = F(800, 21);
    ctx.fillStyle = '#bf4a53';
    ctx.fillText(peso(txDownpayment(confirmedTx)), cardX + cardW - PAD - 18, y + 40);
    ctx.fillStyle = '#111827';
    ctx.fillText(peso(txBalance(confirmedTx)), cardX + cardW - PAD - 18, y + 76);
    y += boxH + 30;
    // Scannable QR (only when QR codes are enabled) above the code pill
    if (qrImg) {
      const box = 216, bx = (W - box) / 2;
      rr(bx, y, box, box, 20);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#eef0f2';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.drawImage(qrImg, bx + 16, y + 16, box - 32, box - 32);
      y += box + 24;
    }
    // Booking-code pill
    ctx.font = F(800, 20, true);
    const pillW = ctx.measureText(code).width + 56;
    const pillX = (W - pillW) / 2;
    rr(pillX, y, pillW, 44, 22);
    const pgrad = ctx.createLinearGradient(pillX, 0, pillX + pillW, 0);
    pgrad.addColorStop(0, '#b33842');
    pgrad.addColorStop(0.5, '#bf4a53');
    pgrad.addColorStop(1, '#d97079');
    ctx.fillStyle = pgrad;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(code, W / 2, y + 29);
    y += 44 + 14;
    ctx.fillStyle = '#9ca3af';
    ctx.font = F(500, 15);
    ctx.fillText('Show this code to staff on pickup.', W / 2, y + 16);
    y += 30;
    // Footer wordmark
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(cardX + PAD, y, cardW - PAD * 2, 1);
    y += 26;
    ctx.font = F(800, 16);
    const wm = 'RENTECH', dot = '.';
    const wmW = ctx.measureText(wm).width + ctx.measureText(dot).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#111827';
    ctx.fillText(wm, (W - wmW) / 2, y + 12);
    ctx.fillStyle = '#bf4a53';
    ctx.fillText(dot, (W - wmW) / 2 + ctx.measureText(wm).width, y + 12);
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `receipt-${code}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const flags = useFeatureFlags();
  // Data URI of the confirmed receipt QR — lets the customer save/download it.
  const [qrSaveUrl, setQrSaveUrl] = useState(null);

  // ---- Step 0: Catalog ----
  if (step === 0) {
    return (
    <div className="fixed inset-0 z-[200] bg-gray-900/40 backdrop-blur-lg" onClick={onClose}>
        <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-select-item" className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-300 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-6 border-b border-gray-100/80">
            <h2 id="dialog-title-select-item" className="text-xl font-bold text-gray-900">Select Item</h2>
            <button onClick={onClose} aria-label="Close item selection" className="p-1 text-gray-400 hover:bg-gray-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50"><X size={20} /></button>
          </div>
          <div className="p-4 flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-full text-xs font-medium focus:outline-none focus:border-[#bf4a53]" />
              </div>
            </div>
            {/* Category filter — compact collapsible multi-select, same design
                as the staff rental flow (single row when closed). */}
            <div ref={catFilterRef} className="relative mb-4">
              {(() => {
                const total = inventory.filter(i => i.status !== 'Deleted' && i.status !== 'OutOfService').length;
                const names = selectedCategories.map(k => catalogCategories.find(c => c.key === k)?.label || k);
                const summary = names.length === 0 ? 'All' : names.length <= 2 ? names.join(', ') : `${names[0]}, +${names.length - 1}`;
                return (
                  <>
                    <button type="button" aria-expanded={catOpen} aria-controls="cust-cat-panel"
                      aria-label={`Filter by category, ${names.length === 0 ? 'showing all categories' : `${names.length} selected: ${names.join(', ')}`}. Activate to change.`}
                      onClick={() => setCatOpen(o => !o)}
                      className={`w-full min-h-[44px] inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53] focus-visible:ring-offset-2 ${
                        selectedCategories.length > 0 ? 'border-[#bf4a53] bg-red-50/60' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <SlidersHorizontal size={15} aria-hidden="true" className="shrink-0 text-gray-400" />
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wide shrink-0">Category</span>
                      <span className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-900">{summary}</span>
                      {selectedCategories.length > 0 && (
                        <span aria-hidden="true" className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[#bf4a53] text-white text-[11px] font-bold inline-flex items-center justify-center tabular-nums">
                          {selectedCategories.length}
                        </span>
                      )}
                      <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-gray-400 transition-transform ${catOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {catOpen && (
                      <div id="cust-cat-panel" role="group" aria-label="Choose categories"
                        className="absolute z-30 top-full mt-2 left-0 right-0 bg-white border border-gray-100 rounded-2xl shadow-xl p-1.5 max-h-64 overflow-y-auto">
                        <label className="flex min-h-[44px] items-center gap-3 px-3 py-1.5 rounded-xl cursor-pointer hover:bg-gray-50 focus-within:ring-2 focus-within:ring-[#bf4a53]/50">
                          <input type="checkbox" checked={selectedCategories.length === 0} onChange={() => setSelectedCategories([])}
                            aria-label={`All categories, ${total} items`} className="h-5 w-5 shrink-0 accent-[#bf4a53]" />
                          <span className="flex-1 text-sm font-semibold text-gray-900">All</span>
                          <span aria-hidden="true" className="text-[11px] font-bold text-gray-400 tabular-nums">{total}</span>
                        </label>
                        {catalogCategories.map(({ key, label }) => {
                          const count = inventory.filter(i => (i.category || '').toLowerCase() === key && i.status !== 'Deleted' && i.status !== 'OutOfService').length;
                          const checked = selectedCategories.includes(key);
                          return (
                            <label key={key} className="flex min-h-[44px] items-center gap-3 px-3 py-1.5 rounded-xl cursor-pointer hover:bg-gray-50 focus-within:ring-2 focus-within:ring-[#bf4a53]/50">
                              <input type="checkbox" checked={checked} onChange={() => toggleCategory(key)}
                                aria-label={`${label}, ${count} items`} className="h-5 w-5 shrink-0 accent-[#bf4a53]" />
                              <span className="flex-1 text-sm font-medium text-gray-800">{label}</span>
                              {checked && <Check size={15} strokeWidth={3} aria-hidden="true" className="shrink-0 text-[#bf4a53]" />}
                              <span aria-hidden="true" className="text-[11px] font-bold text-gray-400 tabular-nums">{count}</span>
                            </label>
                          );
                        })}
                        <div className="flex items-center gap-2 p-1.5 pt-2 border-t border-gray-100 mt-1">
                          <button type="button" onClick={() => setSelectedCategories([])} disabled={selectedCategories.length === 0}
                            className="flex-1 min-h-[40px] rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]">
                            Clear
                          </button>
                          <button type="button" onClick={() => setCatOpen(false)}
                            className="flex-1 min-h-[40px] rounded-xl text-xs font-bold bg-gray-900 text-white hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53] focus-visible:ring-offset-2">
                            Done
                          </button>
                        </div>
                      </div>
                    )}
                    <p aria-live="polite" className="sr-only">
                      Showing {filteredCatalog.length} of {total} items{names.length > 0 ? ` in ${names.join(', ')}` : ''}
                    </p>
                  </>
                );
              })()}
            </div>
            {fieldErrors.item && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl px-4 py-2.5 text-center mb-3">
                {fieldErrors.item}
              </div>
            )}
            <div ref={catalogRef} onScroll={handleCatalogScroll} className="flex-1 overflow-y-auto pr-1 hide-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {displayedItems.map((item) => (
                  <button type="button" key={item.id} onClick={() => setSelectedItem(item)}
                    aria-pressed={selectedItem?.id === item.id} aria-label={`Select ${item.name}, ₱${item.price.toLocaleString()} per day`}
                    className={`bg-white rounded-2xl p-3 flex items-center gap-3 cursor-pointer border-2 transition-all text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/60 ${
                      selectedItem?.id === item.id ? 'border-[#bf4a53] shadow-md' : 'border-transparent hover:border-gray-200'}`}>
                    <ItemImage thumb image={item.image} alt="" className="w-12 h-12 rounded-xl object-cover bg-gray-100" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 line-clamp-1">{item.name}</p>
                      {getSaleInfo(item).active ? (
                        <p className="text-[10px] text-gray-500">
                          <span className="text-red-500 font-bold">₱{getSaleInfo(item).price.toLocaleString()}</span>
                          <span className="line-through ml-1">₱{item.price.toLocaleString()}</span>
                        </p>
                      ) : (
                        <p className="text-[10px] text-gray-500">₱{item.price.toLocaleString()}</p>
                      )}
                      <span className={`inline-block mt-1 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                        item.status === 'Available'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-amber-50 text-amber-600'
                      }`}>
                        {item.status === 'Available' ? 'Available now' : 'Limited — check dates'}
                      </span>
                    </div>
                    {selectedItem?.id === item.id && (
                      <svg className="w-5 h-5 text-[#bf4a53]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
              <div className="py-3 flex justify-center">
                {loadingMore && <Loader2 size={18} className="text-gray-400 animate-spin" />}
                {!loadingMore && allLoaded && filteredCatalog.length > 0 && (
                  <p className="text-xs text-gray-400">All items loaded</p>
                )}
              </div>
            </div>
          </div>
          <div className="p-4 border-t bg-gray-50/50 flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={handleNext} className="flex-[2] py-2.5 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 shadow transition-colors flex items-center justify-center gap-1.5">
              Continue <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
    );
  }

  // ---- Steps 1–3 ----
  const flowContent = (
    <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-complete-booking" className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-300 relative" onClick={(e) => e.stopPropagation()}>
        {isProcessingPayment && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center space-y-4">
            <Loader2 size={48} className="text-[#bf4a53] animate-spin" />
            <p className="font-bold text-gray-900">Processing Payment…</p>
            <p className="text-sm text-gray-500">Please do not close this window</p>
          </div>
        )}
        {paymentSuccess && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center space-y-4">
            <CheckCircle2 size={56} className="text-emerald-500 animate-bounce" />
            <p className="font-bold text-gray-900 text-xl">Payment Confirmed!</p>
            <p className="text-sm text-gray-500">Redirecting to your receipt…</p>
          </div>
        )}

        <div className="flex items-center justify-between p-6 border-b border-gray-100/80">
          <h2 id="dialog-title-complete-booking" className="text-xl font-bold text-gray-900">Complete Booking</h2>
          <button onClick={onClose} aria-label="Close booking" className="p-1 text-gray-400 hover:bg-gray-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50"><X size={20} /></button>
        </div>

        <div className="flex items-center justify-center py-4 px-6 bg-gray-50/50">
          {['Details', 'Payment', 'Receipt'].map((label, idx) => (
            <div key={label} className="flex-1 flex flex-col items-center relative">
              <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                step >= idx + 1 ? 'bg-[#bf4a53] border-[#bf4a53] text-white' : 'bg-white border-gray-200 text-gray-400'}`}>
                {idx + 1}
              </div>
              <span className={`text-[10px] font-bold mt-1 ${step >= idx + 1 ? 'text-[#bf4a53]' : 'text-gray-400'}`}>{label}</span>
              {idx < 2 && <div className={`absolute top-4 left-1/2 w-full h-0.5 ${step > idx + 1 ? 'bg-[#bf4a53]' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {step === 1 && (
            <div className="space-y-5">
              <div className="bg-gradient-to-r from-gray-50 to-white rounded-2xl p-4 flex items-center gap-4 border border-gray-100/60">
                <ItemImage thumb image={selectedItem.image} alt="" className="w-16 h-16 rounded-xl object-cover bg-gray-200 shadow-sm" />
                <div className="flex-1">
                  <p className="font-bold text-gray-900">{selectedItem.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Pickup: {formatDate(rentalDate)}</p>
                  {saleInfo?.active ? (
                    <p className="text-lg font-bold text-[#bf4a53] mt-1">
                      ₱{saleInfo.price.toLocaleString()} <span className="text-xs text-gray-400 line-through font-medium">₱{selectedItem.price.toLocaleString()}</span>
                    </p>
                  ) : (
                    <p className="text-lg font-bold text-[#bf4a53] mt-1">₱{selectedItem.price.toLocaleString()}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Who is this booking for?</label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button onClick={() => toggleAccountDetails(true)}
                    className={`py-3 px-4 rounded-xl text-sm font-bold border transition-all ${
                      useAccountDetails ? 'bg-[#bf4a53] text-white border-[#bf4a53] shadow-sm' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                    {customerInfo?.name ? `Me (${customerInfo.name.split(' ')[0]})` : 'Me'}
                  </button>
                  <button onClick={() => toggleAccountDetails(false)}
                    className={`py-3 px-4 rounded-xl text-sm font-bold border transition-all ${
                      !useAccountDetails ? 'bg-[#bf4a53] text-white border-[#bf4a53] shadow-sm' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                    Someone else
                  </button>
                </div>
              </div>

              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-3">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Contact Details</h4>
                <Field type="text" label="Full Name" placeholder="Full Name" value={customer.name}
                  onChange={(e) => { setCustomer({ ...customer, name: e.target.value }); clearFieldError('name'); }}
                  className={`w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] ${fieldErrors.name ? 'border-red-300 bg-red-50' : ''}`} disabled={useAccountDetails}
                  error={fieldErrors.name || undefined} />
                <div className="grid grid-cols-2 gap-3">
                  <Field type="tel" label="Contact No." placeholder="Contact No." value={customer.contact}
                    onChange={(e) => { setCustomer({ ...customer, contact: e.target.value.replace(/\D/g, '') }); clearFieldError('contact'); }}
                    className={`w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] ${fieldErrors.contact ? 'border-red-300 bg-red-50' : ''}`} disabled={useAccountDetails} inputMode="numeric"
                    error={fieldErrors.contact || undefined} />
                  <Field type="text" label="Address" placeholder="Address" value={customer.address}
                    onChange={(e) => { setCustomer({ ...customer, address: e.target.value }); clearFieldError('address'); }}
                    className={`w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] ${fieldErrors.address ? 'border-red-300 bg-red-50' : ''}`} disabled={useAccountDetails}
                    error={fieldErrors.address || undefined} />
                </div>
              </div>

              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-4">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Calendar size={14} /> Rental Schedule
                </h4>
                {isCleaning ? (
                  <div className="flex items-start gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <Calendar size={16} className="mt-0.5 text-amber-500" />
                    <span>This item is currently being cleaned and can't be booked yet. Please check back once staff mark it available.</span>
                  </div>
                ) : (
                <BookingCalendar
                  pickup={rentalDate}
                  event={eventDate}
                  bookedRanges={bookedRanges}
                  onChange={(p, e) => {
                    eventDateTouched.current = true;
                    setRentalDate(p);
                    setEventDate(e);
                    clearFieldError('rentalDate');
                    clearFieldError('eventDate');
                  }}
                />
                )}
                <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-3 flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5"><Calendar size={16} /></span>
                  <div>
                    <p className="text-xs font-bold text-amber-800">Pick up from the store before your event date</p>
                    <p className="text-[11px] text-amber-600 mt-0.5">Return is due the day after your event ({formatDate(dueDate)}).</p>
                  </div>
                </div>

                {availability.checking && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 size={14} className="animate-spin" /> Checking availability…
                  </div>
                )}
                {!availability.checking && availability.available === true && (
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                    <CheckCircle2 size={16} /> Available for your selected dates.
                  </div>
                )}
                {!availability.checking && availability.available === false && (
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
                    <Calendar size={16} /> {availability.reason || 'Not available for the selected dates.'}
                  </div>
                )}
                {fieldErrors.availability && (
                  <p className="text-[11px] text-red-500 font-medium mt-1 ml-1">{fieldErrors.availability}</p>
                )}
              </div>

              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-3">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Item Details</h4>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">Size</label>
                    <button type="button" onClick={() => setShowSizeGuide(true)}
                      className="text-[10px] font-bold text-[#bf4a53] hover:text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50 rounded">
                      Size Guide
                    </button>
                  </div>
                  <select value={selectedSize} onChange={(e) => { setSelectedSize(e.target.value); clearFieldError('size'); }}
                    className={`w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53] ${fieldErrors.size ? 'border-red-300 bg-red-50' : ''}`}>
                    <option value="">-- Select Size --</option>
                    {['XS','S','M','L','XL','XXL','Custom / Measurements'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {fieldErrors.size && <p className="text-[11px] text-red-500 font-medium mt-1 ml-1">{fieldErrors.size}</p>}
                </div>

                {selectedSize === 'Custom / Measurements' && (
                  <div className="pt-3 border-t border-gray-100">
                    <button onClick={() => setMeasurementsExpanded(!measurementsExpanded)}
                      className="flex items-center justify-between w-full text-xs font-bold text-gray-500 hover:text-[#bf4a53] transition-colors">
                      <span>Custom Measurements</span>
                      <svg className={`w-4 h-4 transition-transform ${measurementsExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    <div className={`grid grid-cols-2 gap-3 mt-3 overflow-hidden transition-all duration-300 ${measurementsExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                      {measurementFields.map(field => (
                        <div key={field}>
                          <label className="text-[10px] font-bold text-gray-400 uppercase">{field.replace(/([A-Z])/g, ' $1')}</label>
                          <input type="number" placeholder="cm"
                            value={measurements[field] || ''}
                            onChange={e => { setMeasurements({...measurements, [field]: e.target.value}); clearFieldError('measurements'); }}
                            className="w-full p-2.5 bg-gray-50 rounded-xl border text-xs focus:outline-none focus:border-[#bf4a53]" />
                        </div>
                      ))}
                    </div>
                    {fieldErrors.measurements && <p className="text-[11px] text-red-500 font-medium mt-2">{fieldErrors.measurements}</p>}
                  </div>
                )}

                <textarea placeholder="Special notes (e.g. size preference, theme)" value={customer.notes}
                  onChange={(e) => setCustomer({ ...customer, notes: e.target.value })}
                  className="w-full p-3 bg-gray-50 rounded-xl border text-sm min-h-[80px] focus:outline-none focus:border-[#bf4a53]" />
              </div>

              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Required Downpayment</p>
                <div className="relative mt-2">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400 pointer-events-none">₱</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={downpaymentAmount}
                    min={minDownpayment}
                    aria-label="Required downpayment amount"
                    onChange={(e) => { setDownpaymentAmount(Math.max(0, Number(e.target.value) || 0)); clearFieldError('downpayment'); }}
                    className={`w-full pl-9 pr-4 py-3 bg-white border rounded-xl text-sm font-bold text-gray-900 placeholder-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53] transition-colors ${fieldErrors.downpayment ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                  />
                </div>
                {fieldErrors.downpayment && (
                  <p className="text-[11px] text-red-500 font-medium ml-1">{fieldErrors.downpayment}</p>
                )}
                <p className="text-[10px] text-gray-400">
                  Minimum of ₱{rentalDefaults.min_downpayment.toLocaleString()} required to secure booking.
                </p>
              </div>
            </div>
          )}

          {/* Promo Code — shown only on the Payment step, never on the receipt */}
          {step === 2 && (
          <div className="bg-gray-50 rounded-2xl p-4 flex flex-col items-center">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2 block text-center">Have a promo code?</label>
            <div className="flex gap-2 w-full max-w-xs justify-center">
              <Field showLabel={false} type="text" value={promoCode} onChange={e => setPromoCode(e.target.value.toUpperCase())}
                placeholder="Enter code" maxLength={20} aria-label="Promo code"
                className="flex-1 p-2.5 bg-white rounded-xl border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/40 focus:border-[#bf4a53]" />
              <button onClick={handleApplyPromo} disabled={!promoCode.trim() || promoApplying}
                className="px-4 py-2.5 bg-[#bf4a53] text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                {promoApplying ? <Loader2 size={14} className="animate-spin" /> : 'Apply'}
              </button>
            </div>
            {promoApplied && (
              <div className="mt-2 p-2.5 bg-emerald-50 rounded-xl flex items-center justify-between w-full max-w-xs">
                <div>
                  <span className="text-xs font-bold text-emerald-700">{promoApplied.code}</span>
                  <span className="text-xs text-emerald-600 ml-2">-{promoApplied.discountPct}% off</span>
                </div>
                <button onClick={() => { setPromoCode(''); setPromoApplied(null); }}
                  className="text-xs text-red-500 font-semibold hover:underline">
                  Remove
                </button>
              </div>
            )}
            {promoError && <p className="text-xs text-red-500 font-medium mt-1 text-center">{promoError}</p>}
            {promoApplied && (
              <div className="mt-2 flex justify-between text-sm w-full max-w-xs">
                <span className="text-gray-500">Discount</span>
                <span className="font-bold text-emerald-600">-₱{promoApplied.discountAmount.toLocaleString()}</span>
              </div>
            )}
          </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="text-center pb-2">
                <h3 className="font-bold text-lg text-gray-900">Payment Method</h3>
                <p className="text-sm text-gray-500">Select how you'd like to pay the downpayment.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setPaymentMethod('gcash')}
                  className={`p-6 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all ${
                    paymentMethod === 'gcash' ? 'border-[#bf4a53] bg-red-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <Smartphone size={28} className={paymentMethod === 'gcash' ? 'text-[#bf4a53]' : 'text-gray-400'} />
                  <span className="text-sm font-bold text-gray-900">GCash</span>
                </button>
                <button onClick={() => setPaymentMethod('card')}
                  className={`p-6 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all ${
                    paymentMethod === 'card' ? 'border-[#bf4a53] bg-red-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <CreditCard size={28} className={paymentMethod === 'card' ? 'text-[#bf4a53]' : 'text-gray-400'} />
                  <span className="text-sm font-bold text-gray-900">Card</span>
                </button>
              </div>
                <div className="bg-gray-50 p-5 rounded-2xl space-y-2 border border-gray-100/60">
                  <div className="flex justify-between text-sm"><span className="text-gray-600">Downpayment</span><span className="font-bold">₱{downpaymentAmount.toLocaleString()}</span></div>
                  {promoApplied && (
                    <div className="flex justify-between text-sm text-emerald-600"><span>Promo discount ({promoApplied.code})</span><span className="font-bold">−₱{promoApplied.discountAmount.toLocaleString()}</span></div>
                  )}
                  <div className="flex justify-between text-sm"><span className="text-gray-600">Remaining Balance</span><span className="font-bold text-gray-900">₱{(finalFee - downpaymentAmount).toLocaleString()}</span></div>
                  <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between text-base"><span className="font-bold text-gray-900">Total</span><span className="font-bold text-[#bf4a53]">₱{finalFee.toLocaleString()}</span></div>
                  <p className="text-[10px] text-gray-400 mt-1">Balance payable at pickup.</p>
                </div>
            </div>
          )}

          {step === 3 && confirmedTx && (
            <div className="space-y-5">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={32} className="text-emerald-500" />
                </div>
                <h3 className="text-xl font-bold text-gray-900">Booking Confirmed!</h3>
                <p className="text-gray-500 text-sm mt-1">Your reservation has been secured.</p>
              </div>
              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-2.5 text-sm shadow-sm">
                <p className="font-bold text-gray-900 text-base mb-2">{selectedItem.name}</p>
                <div className="flex justify-between"><span className="text-gray-500">Pickup</span><span>{formatDate(rentalDate)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Event Date</span><span className="font-semibold">{formatDate(eventDate)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Return By</span><span className="text-amber-600 font-semibold">{formatDate(dueDate)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Customer</span><span>{confirmedTx.customer?.name || customer.name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Size</span><span>{confirmedTx.size}</span></div>
                <div className="border-t border-gray-100 pt-2.5 mt-2.5 flex justify-between"><span className="text-gray-500">Downpayment</span><span className="text-[#bf4a53] font-bold">₱{txDownpayment(confirmedTx).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Balance</span><span className="font-bold">₱{txBalance(confirmedTx).toLocaleString()}</span></div>
              </div>
              <div className="flex flex-col items-center gap-2">
                {flags.qr_codes ? (
                  <>
                    <button onClick={handleQRTap}
                      className="relative bg-white p-4 rounded-2xl border border-gray-200 shadow-sm group cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02]"
                      title="Tap to view booking details">
                      {/* Real, scannable QR (encodes the booking code). Server-rendered data URI on the booking response, otherwise generated client-side. */}
                      <BookingQR tx={confirmedTx} size={144} showCode={false} onDataUrl={setQrSaveUrl} />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 rounded-2xl">
                        <div className="flex items-center gap-2 text-[#bf4a53] font-bold">
                          <ScanLine size={20} /> Tap to view
                        </div>
                      </div>
                    </button>
                    <p className="font-mono text-[11px] font-bold tracking-wide text-gray-500">{bookingCode(confirmedTx)}</p>
                    <p className="text-[11px] text-gray-400 text-center -mt-1">Show this code to staff on pickup — they can scan it to pull up your order.</p>
                    {qrSaveUrl && (
                      <a
                        href={qrSaveUrl}
                        download={`${bookingCode(confirmedTx)}.png`}
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#bf4a53] bg-red-50 hover:bg-red-100 rounded-full px-3 py-1.5 transition-colors"
                        title="Save a copy of this QR code">
                        <Download size={13} /> Save QR
                      </a>
                    )}
                  </>
                ) : (
                  <button onClick={handleQRTap}
                    className="text-[#bf4a53] text-sm font-bold hover:underline flex items-center gap-1.5">
                    <ScanLine size={16} /> View booking details
                  </button>
                )}
              </div>
              <p className="text-xs text-center text-gray-400">Transaction ID: {confirmedTx.id}</p>
              {confirmError && (
                <p className="text-xs text-center text-red-500 font-medium bg-red-50 py-2 rounded-lg">{confirmError}</p>
              )}
              <button onClick={handleSaveReceipt}
                className="w-full py-3.5 bg-white border border-gray-200 text-gray-800 font-bold rounded-full hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                <Download size={16} /> Save Receipt
              </button>
              <button onClick={handleConfirm} disabled={confirming}
                className="w-full py-3.5 bg-gray-900 text-white font-bold rounded-full hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {confirming ? 'Processing...' : 'Done'}
              </button>
            </div>
          )}
        </div>

        {step < 3 && (
          <div className="p-4 border-t bg-gray-50/50 flex gap-3">
            <button onClick={handleBack} className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
              {step > 1 ? 'Back' : 'Cancel'}
            </button>
            <button
              onClick={handleNext}
              disabled={step === 1 && (availability.checking || availability.available === false || isCleaning)}
              className="flex-[2] py-2.5 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 shadow transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
              {step === 0 ? 'Continue' : step === 1 ? (availability.checking ? 'Checking…' : 'Continue to Payment') : 'Confirm Payment'} <ChevronRight size={16} />
            </button>
          </div>
        )}
    </div>
  );

  return inline ? flowContent : (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
        {flowContent}
      {showQRDetails && confirmedTx && (
        <div className="fixed inset-0 bg-gray-900/70 backdrop-blur-sm z-[250] flex items-center justify-center p-4" onClick={() => setShowQRDetails(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-booking-info" className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in fade-in duration-200 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 id="dialog-title-booking-info" className="font-bold text-lg text-gray-900">Booking Info</h3>
              <button onClick={() => setShowQRDetails(false)} aria-label="Close booking info" className="text-gray-400 hover:bg-gray-100 rounded-full p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50"><X size={18} /></button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ['Booking ID', confirmedTx.id, 'font-mono font-bold'],
                ['Booking Code', bookingCode(confirmedTx), 'font-mono font-bold'],
                ['Customer', confirmedTx.customer?.name || customer.name, 'font-bold'],
                ['Item', confirmedTx.item?.name || selectedItem?.name, ''],
                ['Size', confirmedTx.size, ''],
                ['Pickup', formatDate(rentalDate), ''],
                ['Event Date', formatDate(eventDate), 'font-semibold'],
                ['Return By', formatDate(dueDate), 'text-amber-600 font-semibold'],
                ['Status', confirmedTx.status, 'text-emerald-600 font-bold'],
                ['Downpayment', `₱${txDownpayment(confirmedTx).toLocaleString()}`, ''],
              ].map(([label, value, rowCls]) => {
                if (value == null || value === '') return null;
                return (
                  <div key={label} className="flex justify-between"><span className="text-gray-500">{label}</span><span className={rowCls}>{value}</span></div>
                );
              })}
            </div>
            <button onClick={() => setShowQRDetails(false)} className="w-full mt-6 py-3 bg-gray-900 text-white font-bold rounded-full hover:bg-gray-800 transition-colors">Close</button>
          </div>
        </div>
      </div>
      )}

      {/* Size Guide */}
      {showSizeGuide && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowSizeGuide(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-size-guide"
            className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md flex justify-between items-center p-5 border-b border-gray-100/80 rounded-t-3xl">
              <h3 id="dialog-title-size-guide" className="font-bold text-lg text-gray-900">Size Guide</h3>
              <button onClick={() => setShowSizeGuide(false)} aria-label="Close size guide"
                className="text-gray-400 hover:bg-gray-100 rounded-full p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                All measurements below are the garment's base dimensions. Our boutique
                offers on-site tailoring — if your body measurements differ from the
                chart, pick <strong>Custom / Measurements</strong> and we'll adjust
                the fit before your event.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-left font-bold text-gray-600 border border-gray-200">Size</th>
                      <th className="px-3 py-2 text-center font-bold text-gray-600 border border-gray-200">Bust (in)</th>
                      <th className="px-3 py-2 text-center font-bold text-gray-600 border border-gray-200">Waist (in)</th>
                      <th className="px-3 py-2 text-center font-bold text-gray-600 border border-gray-200">Hips (in)</th>
                      <th className="px-3 py-2 text-center font-bold text-gray-600 border border-gray-200">Shoulder (in)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['XS', '31–32', '23–24', '33–34', '14'],
                      ['S', '33–34', '25–26', '35–36', '14.5'],
                      ['M', '35–36', '27–28', '37–38', '15'],
                      ['L', '37–39', '29–31', '39–41', '15.5–16'],
                      ['XL', '40–42', '32–34', '42–44', '16.5–17'],
                      ['XXL', '43–45', '35–37', '45–47', '17.5–18'],
                    ].map(([size, bust, waist, hips, shoulder]) => (
                      <tr key={size} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-bold text-gray-900 border border-gray-200">{size}</td>
                        <td className="px-3 py-2 text-center text-gray-600 border border-gray-200 tabular-nums">{bust}</td>
                        <td className="px-3 py-2 text-center text-gray-600 border border-gray-200 tabular-nums">{waist}</td>
                        <td className="px-3 py-2 text-center text-gray-600 border border-gray-200 tabular-nums">{hips}</td>
                        <td className="px-3 py-2 text-center text-gray-600 border border-gray-200 tabular-nums">{shoulder}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-amber-50 border border-amber-200/70 rounded-2xl p-4 text-xs text-amber-800 leading-relaxed space-y-1.5">
                <p className="font-bold">How to choose your size:</p>
                <p><strong>1.</strong> Measure yourself with a soft tape (bust, waist, hips).</p>
                <p><strong>2.</strong> Match your largest measurement to the chart above.</p>
                <p><strong>3.</strong> If you fall between sizes, pick <strong>Custom / Measurements</strong> — our tailor will adjust the garment to fit you perfectly.</p>
                <p><strong>4.</strong> Our gowns can be taken in or let out by about 1 inch in each area.</p>
              </div>
              <button onClick={() => setShowSizeGuide(false)}
                className="w-full py-3 bg-gray-900 text-white font-bold rounded-full hover:bg-gray-800 transition-colors text-sm">
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
