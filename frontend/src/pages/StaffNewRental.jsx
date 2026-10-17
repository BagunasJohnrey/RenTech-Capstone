import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Loader2, Search, Calendar, Check, Percent, ShieldCheck, CheckCircle2, Download, SlidersHorizontal, ChevronDown, Banknote, CreditCard, QrCode, ExternalLink, ScanLine, RotateCcw } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../utils/api';
import ItemImage from '../components/ItemImage';
import BookingCalendar from '../components/BookingCalendar';
import DatePickGuide from '../components/DatePickGuide';
import ScheduleChips, { shortDate } from '../components/ScheduleChips';
import CollapsibleSection from '../components/CollapsibleSection';
import Field from '../components/ui/Field';
import BookingReceipt from '../components/BookingReceipt';
import BottomSheet from '../components/BottomSheet';
import ManualQrPanel from '../components/ManualQrPanel';
import { inventoryService } from '../services/inventory';
import { promoService } from '../services/promo';
import { promoDiscountLabel } from '../utils/promoLabel';
import { paymentsService } from '../services/payments';
import { usePaymongo } from '../hooks/usePaymongo';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { downloadReceiptImage } from '../utils/receiptImage';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { toLocalYmd, todayYmd } from '../utils/format';
import {
  INPUT_LIMITS,
  sanitizeName,
  sanitizePhone,
  sanitizeAddress,
  sanitizeNotes,
} from '../utils/inputLimits';

const ITEMS_PER_LOAD = 6;

export default function StaffNewRental({ inventory, transactions = [], onAddTransaction, onClose, initialItem }) {
  // Discard-confirmation for Back / close: shown when the form has unsaved
  // entries so an accidental tap doesn't wipe the whole rental.
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [confirmNav, setConfirmNav] = useState(null); // 'back' | 'close'

  // Steps
  const [step, setStep] = useState(initialItem ? 2 : 1);

  // Catalog search & filter (multi-select: empty = All)
  const [selectedCategories, setSelectedCategories] = useState([]);
  const toggleCategory = (key) => {
    setSelectedCategories(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };
  // Collapsible category dropdown (compact single row when closed)
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
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_LOAD);
  const [loadingMore, setLoadingMore] = useState(false);
  const catalogRef = useRef(null);

  // Selected item (only one at a time)
  const [selectedItem, setSelectedItem] = useState(initialItem || null);

  const todayStr = useMemo(() => todayYmd(), []);

  // Fetch return-days-after-event + minimum downpayment + payment gateway
  // from admin rules (same floor + gateway as the customer flow).
  const [returnDays, setReturnDays] = useState(1);
  const [minDownpayment, setMinDownpayment] = useState(200);
  const [gateway, setGateway] = useState('paymongo');
  const [manualQrCodes, setManualQrCodes] = useState([]);
  const [manualChannel, setManualChannel] = useState('');
  useEffect(() => {
    api.get('/settings/rental-defaults')
      .then((d) => {
        if (d?.return_days_after_event) setReturnDays(d.return_days_after_event);
        if (d?.min_downpayment) setMinDownpayment(d.min_downpayment);
        if (d?.payment_gateway === 'maya') setGateway('maya');
        else if (d?.payment_gateway === 'manual') setGateway('manual');
        else setGateway('paymongo');
        const codes = Array.isArray(d?.manual_qr_codes) ? d.manual_qr_codes : [];
        setManualQrCodes(codes);
        if (codes[0]) setManualChannel(codes[0].id);
      })
      .catch(() => {});
  }, []);

  // Channel label for the manual-transfer note (falls back to the first QR).
  const manualChannelLabel = manualQrCodes.find((q) => q.id === manualChannel)?.label
    || manualQrCodes[0]?.label || 'InstaPay';

  // Existing bookings for the selected item (active/overdue/returned) => unavailable dates,
  // including the 1-day cleaning window after a return. Sourced from the backend so it
  // stays consistent with the customer flow and the availability checks.
  const [bookedRanges, setBookedRanges] = useState([]);
  useEffect(() => {
    if (!selectedItem) {
      setBookedRanges([]);
      return;
    }
    let active = true;
    inventoryService
      .blockedDates(selectedItem.id)
      .then((res) => { if (active) setBookedRanges(res.blockedRanges || []); })
      .catch(() => { if (active) setBookedRanges([]); });
    return () => { active = false; };
  }, [selectedItem]);

  const handleCalendarChange = (p, e) => {
    const updated = { ...customer, rentalDate: p, eventDate: e };
    if (e) {
      const ret = new Date(e);
      ret.setDate(ret.getDate() + returnDays);
      updated.returnDate = toLocalYmd(ret);
    } else {
      updated.returnDate = '';
    }
    setCustomer(updated);
    setFieldErrors((prev) => ({ ...prev, rentalDate: '', eventDate: '' }));
  };

  // Customer details — dates start EMPTY so staff must tap both days on
  // the calendar (no prefill).
  const [customer, setCustomer] = useState(() => {
    return {
      name: '', contact: '', address: '',
      rentalDate: '',
      eventDate: '',
      returnDate: '',
      notes: '',
      photoUrl: null,
    };
  });

  // Downpayment — required, same floor as the customer flow (never more
  // than the fee being charged). Prefilled once an item is picked.
  const [downpaymentAmount, setDownpaymentAmount] = useState('');
  useEffect(() => {
    if (selectedItem && !String(downpaymentAmount ?? '').trim()) {
      setDownpaymentAmount(String(minDownpayment || 200));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem, minDownpayment]);

  // Discount: staff picks the % first; the admin approves that exact amount
  // with their PIN at order confirmation. The approval is bound to the % +
  // item — any change after approval voids it and forces re-approval, so
  // staff can't get a blank approval and inflate the discount afterwards.
  const [discountPct, setDiscountPct] = useState(0);
  const [discountAuthorized, setDiscountAuthorized] = useState(null); // { admin, pct, itemId, pin } | null
  // Counter voucher code (same server-side vouchers as the customer flow).
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(null);
  const [promoError, setPromoError] = useState('');
  const [promoApplying, setPromoApplying] = useState(false);
  const handleApplyPromo = async (codeOverride) => {
    const raw = (codeOverride ?? promoCode).trim().toUpperCase();
    if (!raw || !selectedItem || promoApplying) return;
    setPromoApplying(true);
    setPromoError('');
    try {
      const result = await promoService.validate({
        code: raw, rentalFee: selectedItem.price || 0, itemCategory: selectedItem.category,
      });
      setPromoCode(result.code || raw);
      setPromoApplied(result);
    } catch (err) {
      setPromoApplied(null);
      setPromoError(err?.message || 'Invalid promo code');
    }
    setPromoApplying(false);
  };
  const clearPromo = () => { setPromoCode(''); setPromoApplied(null); setPromoError(''); };
  const [showAdminAuth, setShowAdminAuth] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Approval is only valid for the exact % + item the admin saw.
  const isDiscountApproved = !!discountAuthorized
    && discountPct > 0
    && discountAuthorized.pct === discountPct
    && discountAuthorized.itemId === selectedItem?.id;

  const handleDiscountChange = (pct) => {
    setDiscountPct(pct);
    // Any edit after approval voids it — the new amount needs its own approval.
    if (discountAuthorized && discountAuthorized.pct !== pct) setDiscountAuthorized(null);
  };

  // Switching items voids the approval (the peso amount changed) and any
  // applied voucher (it was validated against the old item's price).
  useEffect(() => {
    if (discountAuthorized && discountAuthorized.itemId !== selectedItem?.id) {
      setDiscountAuthorized(null);
    }
    setPromoCode(''); setPromoApplied(null); setPromoError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id]);

  // Size & measurements
  const [size, setSize] = useState('');
  const [measurementsExpanded, setMeasurementsExpanded] = useState(false);
  const [measurements, setMeasurements] = useState({});

  // Measurement fields (based on category)
  const measurementFields = useMemo(() => {
    const isFemale = selectedItem?.category?.toLowerCase().includes('gown');
    return isFemale
      ? ['bust', 'waist', 'hips', 'shoulderToFloor', 'shoulderWidth']
      : ['shoulder', 'chest', 'waist', 'sleeveLength', 'pantsLength', 'neck'];
  }, [selectedItem]);

  // Validation state
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [touchedFields, setTouchedFields] = useState({});

  // Submit guard: once a booking is sent, ignore further clicks until the
  // modal closes (prevents duplicate rentals from double-clicking).
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Created transaction — shown on the post-booking receipt step (with QR).
  const [createdTx, setCreatedTx] = useState(null);

  // Payment channel for the downpayment: cash (recorded with the booking) or
  // online (real gateway charge collected right after the booking is created).
  const [payChannel, setPayChannel] = useState('cash');
  const [collecting, setCollecting] = useState(false);
  const [gatewayIntent, setGatewayIntent] = useState(null);
  const [gatewayQrUrl, setGatewayQrUrl] = useState(null);
  const [gatewayStatus, setGatewayStatus] = useState(null);
  const [collectError, setCollectError] = useState('');
  const { openDropIn } = usePaymongo();
  const flags = useFeatureFlags();
  const pollStopRef = useRef(false);
  useEffect(() => () => { pollStopRef.current = true; }, []);

  // Live availability check (same backend overlap logic as createRental) so
  // staff can't confirm dates that clash with an existing booking.
  const [availability, setAvailability] = useState({ checking: false, available: null, reason: '' });
  useEffect(() => {
    if (!selectedItem || !customer.rentalDate || !customer.returnDate) {
      setAvailability({ checking: false, available: null, reason: '' });
      return;
    }
    let active = true;
    setAvailability({ checking: true, available: null, reason: '' });
    inventoryService
      .availability(selectedItem.id, customer.rentalDate, customer.returnDate)
      .then((res) => { if (active) setAvailability({ checking: false, available: res.available, reason: res.reason || '' }); })
      .catch(() => { if (active) setAvailability({ checking: false, available: null, reason: '' }); });
    return () => { active = false; };
  }, [selectedItem, customer.rentalDate, customer.returnDate]);

  // Auto-scroll to first invalid input when validation fails
  const step2Ref = useRef(null);
  useEffect(() => {
    const hasErrors = Object.keys(fieldErrors).filter(k => k !== 'item').length > 0;
    if (hasErrors && step2Ref.current) {
      const firstErr = step2Ref.current.querySelector('.border-red-300');
      if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [fieldErrors]);

  const clearFieldError = (field) => {
    setFieldErrors(prev => ({ ...prev, [field]: '' }));
  };

  const touchField = (field) => setTouchedFields(prev => ({ ...prev, [field]: true }));

  const inputClass = (field, extra = '') => {
    if (fieldErrors[field]) return `w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53] border-red-300 bg-red-50 ${extra}`;
    if (touchedFields[field] && fieldValid[field]) return `w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53] border-green-400 bg-green-50 ${extra}`;
    return `w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53] ${extra}`;
  };

  const validateStep2 = () => {
    const errs = {};
    const nameTrimmed = (customer.name || '').trim();
    if (nameTrimmed.length < INPUT_LIMITS.NAME_MIN) errs.name = 'Full name is required (min 2 characters)';
    else if (nameTrimmed.length > INPUT_LIMITS.NAME_MAX) errs.name = `Full name must be ${INPUT_LIMITS.NAME_MAX} characters or fewer`;
    else if (/\d/.test(nameTrimmed)) errs.name = 'Name must not contain numbers';
    if (!customer.contact || !/^\d{11}$/.test(customer.contact.trim())) errs.contact = 'Contact number must be exactly 11 digits';
    const addrTrimmed = (customer.address || '').trim();
    if (addrTrimmed.length < INPUT_LIMITS.ADDRESS_MIN) errs.address = 'Address is required (min 5 characters)';
    else if (addrTrimmed.length > INPUT_LIMITS.ADDRESS_MAX) errs.address = `Address must be ${INPUT_LIMITS.ADDRESS_MAX} characters or fewer`;
    if (!customer.rentalDate) errs.rentalDate = 'Please select a pickup date.';
    else if (new Date(customer.rentalDate) < new Date(todayStr)) errs.rentalDate = 'Pickup date cannot be in the past';
    if (!customer.eventDate) errs.eventDate = 'Please select an event date.';
    else if (new Date(customer.eventDate) < new Date(customer.rentalDate)) errs.eventDate = 'Event date must be on or after pickup date';
    if (!size) errs.size = 'Please select a size';
    if (selectedItem && customer.eventDate) {
      const overlap = bookedRanges.some(
        (r) => customer.rentalDate <= r.end && customer.eventDate >= r.start
      );
      if (overlap) errs.rentalDate = 'Selected dates overlap an existing booking for this item';
    }
    if (availability.available === false) errs.rentalDate = availability.reason || 'Selected dates are not available for this item';
    if (size === 'Custom / Measurements' && measurementsExpanded) {
      const filled = measurementFields.filter(f => measurements[f] && String(measurements[f]).trim());
      if (filled.length < 3) errs.measurements = 'Please provide at least 3 measurements';
    }
    // Required downpayment, same rule as the customer flow: at least the
    // flat floor (default ₱200), never more than the fee being charged.
    {
      const base = selectedItem?.price || 0;
      const fee = base - Math.round(base * (discountPct / 100));
      const min = Math.min(minDownpayment || 200, fee);
      const dp = Number(downpaymentAmount) || 0;
      if (!dp || dp <= 0) errs.downpayment = 'Downpayment is required';
      else if (dp < min) errs.downpayment = `Downpayment must be at least ₱${min.toLocaleString()}`;
      else if (dp > fee) errs.downpayment = 'Downpayment cannot exceed the rental fee';
    }
    setFieldErrors(errs);
    setTouchedFields(prev => ({ ...prev, ...Object.fromEntries(Object.keys(errs).map(k => [k, true])) }));
    return Object.keys(errs).length === 0;
  };

  // Derived totals — voucher first, then the PIN-approved staff % on top
  // (mirrors the server order in createRental). The booking only carries the
  // discount when it is approved (see submitBooking).
  const totals = useMemo(() => {
    const base = selectedItem?.price || 0;
    const promoFee = promoApplied?.finalFee ?? base;
    const promoDiscount = Math.max(0, base - promoFee);
    const discountAmt = Math.round(promoFee * (discountPct / 100));
    const afterDiscount = promoFee - discountAmt;
    const dp = Number(downpaymentAmount) || 0;
    return { baseRate: base, promoDiscount, promoCode: promoApplied?.code || null, discount: discountAmt, discountedRate: afterDiscount, downpayment: dp, balance: afterDiscount - dp };
  }, [selectedItem, downpaymentAmount, discountPct, promoApplied]);

  // Live field validity (green glow when valid)
  const fieldValid = useMemo(() => {
    const v = {};
    const nm = customer.name?.trim() ?? '';
    if (nm.length >= INPUT_LIMITS.NAME_MIN && nm.length <= INPUT_LIMITS.NAME_MAX && !/\d/.test(nm)) v.name = true;
    if (/^\d{11}$/.test(customer.contact?.trim())) v.contact = true;
    const ad = customer.address?.trim() ?? '';
    if (ad.length >= INPUT_LIMITS.ADDRESS_MIN && ad.length <= INPUT_LIMITS.ADDRESS_MAX) v.address = true;
    if (customer.rentalDate && new Date(customer.rentalDate) >= new Date(todayStr)) v.rentalDate = true;
    if (customer.eventDate && customer.rentalDate && new Date(customer.eventDate) >= new Date(customer.rentalDate)) v.eventDate = true;
    if (size) v.size = true;
    if (size === 'Custom / Measurements' && measurementsExpanded) {
      const filled = measurementFields.filter(f => measurements[f] && String(measurements[f]).trim());
      if (filled.length >= 3) v.measurements = true;
    } else     if (size && size !== 'Custom / Measurements') {
      v.measurements = true;
    }
    {
      const base = selectedItem?.price || 0;
      const promoFee = promoApplied?.finalFee ?? base;
      const fee = promoFee - Math.round(promoFee * (discountPct / 100));
      const min = Math.min(minDownpayment || 200, fee);
      const dp = Number(downpaymentAmount) || 0;
      if (dp >= min && dp <= fee && fee > 0) v.downpayment = true;
    }
    return v;
  }, [customer, todayStr, size, measurementsExpanded, measurements, measurementFields, downpaymentAmount, selectedItem, discountPct, promoApplied, minDownpayment]);

  // Category tabs (with live counts) built from the actual inventory so every
  // category (Gown, Barong, Filipiniana, Suit, Costume, …) always appears —
  // no hardcoded list to go stale.
  const catalogCategories = useMemo(() => {
    const seen = [];
    for (const item of inventory) {
      if (item.status === 'Deleted') continue;
      const label = item.category || 'Other';
      if (!seen.some(c => c.key === label.toLowerCase())) seen.push({ key: label.toLowerCase(), label });
    }
    return seen;
  }, [inventory]);

  // Filtered catalog (staff can pick any bookable item, including ones that are
  // currently Rented/Reserved — so they can reserve a future-free date). Deleted
  // items are excluded since they're removed from the catalog. Available items
  // sort first so bookable garments are always on top; the category filter and
  // search still apply across everything.
  const filteredCatalog = useMemo(() => {
    const rank = (status) => (status === 'Available' ? 0 : 1);
    return inventory
      .filter(item => {
        if (item.status === 'Deleted') return false;
        const matchesCat = selectedCategories.length === 0 || selectedCategories.includes((item.category || '').toLowerCase());
        const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCat && matchesSearch;
      })
      .sort((a, b) => rank(a.status) - rank(b.status));
  }, [inventory, selectedCategories, searchQuery]);

  // Reset visibleCount when filters change
  useEffect(() => {
    setVisibleCount(ITEMS_PER_LOAD);
    setLoadingMore(false);
  }, [selectedCategories, searchQuery]);

  // Slice the items for display
  const displayedItems = filteredCatalog.slice(0, visibleCount);
  const allLoaded = visibleCount >= filteredCatalog.length;

  // Reveal the next page of items. Used by infinite scroll AND the explicit
  // "Show more" button — the button matters on tall screens where the capped
  // list fits the first page exactly and no scroll event ever fires.
  const loadMore = useCallback(() => {
    if (loadingMore || allLoaded) return;
    setLoadingMore(true);
    // Simulate network
    setTimeout(() => {
      setVisibleCount(prev => Math.min(prev + ITEMS_PER_LOAD, filteredCatalog.length));
      setLoadingMore(false);
    }, 400);
  }, [loadingMore, allLoaded, filteredCatalog.length]);

  // Infinite scroll handler
  const handleCatalogScroll = useCallback(() => {
    const el = catalogRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) loadMore();
  }, [loadMore]);

  // Navigation helpers
  const handleBack = () => {
    if (step > 1) setStep(s => s - 1);
    else onClose();
  };

  // Pristine form snapshot (mount time) for the unsaved-changes check below.
  const initialCustomerRef = useRef(null);
  if (initialCustomerRef.current === null) {
    initialCustomerRef.current = { ...customer };
  }
  // The item we opened with (tap-to-book preselects one): merely having it
  // is NOT a change — only picking a different item counts. Otherwise every
  // swipe-down on a freshly opened booking asks "Discard changes?".
  const initialItemIdRef = useRef(initialItem?.id ?? null);

  // True when the user typed/changed anything worth keeping: a selected item,
  // customer details, dates, size/measurements, downpayment or a discount.
  // The receipt step (booking committed) is always safe to leave. Pure filter
  // UI (search text, category pills) never triggers the guard.
  const hasUnsavedChanges = useMemo(() => {
    if (step === 4 || createdTx) return false;
    if ((selectedItem?.id ?? null) !== initialItemIdRef.current) return true;
    const init = initialCustomerRef.current || {};
    if ((customer.name || '').trim() || (customer.contact || '').trim() ||
        (customer.address || '').trim() || (customer.notes || '').trim()) return true;
    if (customer.rentalDate !== init.rentalDate || customer.eventDate !== init.eventDate ||
        customer.returnDate !== init.returnDate) return true;
    if (size || Object.keys(measurements || {}).some(k => String(measurements[k] ?? '').trim() !== '')) return true;
    if (String(downpaymentAmount ?? '').trim() !== '') return true;
    if ((Number(discountPct) || 0) > 0 || discountAuthorized) return true;
    if ((promoCode || '').trim() !== '' || promoApplied) return true;
    return false;
  }, [step, createdTx, selectedItem, customer, size, measurements, downpaymentAmount, discountPct, discountAuthorized, promoCode, promoApplied]);

  // Back / close go through here: with unsaved entries the user gets a
  // "Discard changes?" confirm instead of silently losing the rental.
  const requestNavigate = useCallback((target) => {
    if (target === 'close' && (step === 4 || createdTx)) { onClose(); return; }
    // Step-back keeps every field (nothing is lost), so it never asks.
    // Only LEAVING the modal confirms — and the exit-confirm only fires
    // from step 1's Back (steps 2/3 always return to a previous step).
    if (target === 'back' && step > 1) { handleBack(); return; }
    if (hasUnsavedChanges) {
      setConfirmNav('close');
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  }, [hasUnsavedChanges, step, createdTx, onClose]);

  const confirmDiscard = useCallback(() => {
    setShowDiscardConfirm(false);
    setConfirmNav(null);
    onClose();
  }, [onClose]);

  // Escape closes the page — but stays off while any modal is up so one
  // keypress can't skip a level; the discard confirm gets its own Escape.
  useEscapeClose(() => requestNavigate('close'), !showDiscardConfirm && !showAdminAuth);
  useEscapeClose(() => { setShowDiscardConfirm(false); setConfirmNav(null); }, showDiscardConfirm);

  // Mobile system back button (dispatched by App as rentech:request-close).
  // Routes through the same discard-confirm guard as the Back button; an
  // open discard/admin modal is dismissed first instead of the page.
  useEffect(() => {
    const onRequestClose = () => {
      if (showDiscardConfirm) { setShowDiscardConfirm(false); setConfirmNav(null); return; }
      if (showAdminAuth) { setShowAdminAuth(false); return; }
      requestNavigate('close');
    };
    window.addEventListener('rentech:request-close', onRequestClose);
    return () => window.removeEventListener('rentech:request-close', onRequestClose);
  }, [requestNavigate, showDiscardConfirm, showAdminAuth]);

  // Admin authorization via the admin's 4-digit discount PIN — approves the
  // exact % + item currently selected and LOCKS it (the slider disables, so
  // staff can't edit the discount after approval; Remove + re-pick needs a
  // fresh approval). PIN success never auto-submits: staff press Confirm
  // again to process the order.
  const handleAuthorize = async () => {
    if (adminPin.length !== 4) { setAuthError('Enter the 4-digit PIN'); return; }
    setAuthLoading(true); setAuthError('');
    try {
      const res = await api.post('/auth/verify-admin', { pin: adminPin });
      // The PIN itself is retained in memory (never persisted/logged) so the
      // server can re-verify it at booking time; it dies with this form.
      setDiscountAuthorized({ admin: res.admin, pct: discountPct, itemId: selectedItem?.id, pin: adminPin });
      setShowAdminAuth(false);
      setAdminPin('');
    } catch (err) {
      setAuthError(err?.body?.error || err?.message || 'Authorization failed');
    } finally { setAuthLoading(false); }
  };

  const handleNext = async () => {
    if (step === 1) {
      if (!selectedItem) {
        setFieldErrors({ item: 'Please select an item' });
        return;
      }
      setFieldErrors({});
    }
    if (step === 2) {
      if (!validateStep2()) return;
      setFieldErrors({});
    }
    if (step === 3) {
      if (submittingRef.current) return;
      if (!validateStep2()) return;
      // Discount without a matching approval → admin PIN first (approves the
      // exact amount shown). No auto-submit: staff press Confirm again after.
      if (discountPct > 0 && !isDiscountApproved) {
        setAuthError('');
        setAdminPin('');
        setShowAdminAuth(true);
        return;
      }
      // Online collects the downpayment through the gateway right after the
      // booking is created; cash just records it with the booking.
      // Manual gateway collects the downpayment at the counter: the booking is
      // created, then staff record the verified InstaPay transfer. Cash records
      // it with the booking; a real gateway charges it after creation.
      if (payChannel === 'online') {
        if (gateway === 'manual') submitBookingManual();
        else submitBookingOnline();
      } else submitBooking();
      return;
    }
    setStep(s => s + 1);
  };

  // Manual collection: create the booking, then record the verified InstaPay
  // transfer as the downpayment through the same record path the counter uses.
  // No gateway intent, no polling — the staff member verified it in person. On
  // a failed record the booking still stands and the balance falls due at pickup.
  const submitBookingManual = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setCollectError('');
    try {
      const created = await createBookingRecord();
      const amt = Number(totals.downpayment) || 0;
      if (amt > 0) {
        try {
          const res = await api.post(`/transactions/${created.id}/payments`, {
            amount: amt,
            method: 'instapay',
            notes: `${manualChannelLabel} transfer — verified in person`,
          });
          setCreatedTx({ ...created, totalPaid: res.totalPaid, balance: res.balance });
        } catch (recErr) {
          setCreatedTx(created);
          setCollectError(recErr?.message || 'Booking saved — record the downpayment at pickup.');
        }
      } else {
        setCreatedTx(created);
      }
      setSubmitting(false);
      submittingRef.current = false;
      setStep(4);
    } catch (err) {
      setError(err?.message || 'Failed to create rental. Please try again.');
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  // Online collection: the booking is created first (an intent needs a
  // transaction id), then the downpayment is charged through the gateway.
  // The receipt lands only after the gateway confirms — Maya via QR + poll,
  // PayMongo via drop-in + poll. Anything unrecoverable falls back to the
  // receipt with the balance due at pickup (release stays locked until ₱0).
  const submitBookingOnline = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setCollectError('');
    setGatewayIntent(null);
    setGatewayQrUrl(null);
    setGatewayStatus(null);
    try {
      const created = await createBookingRecord();
      // Seed immediately so the poller can merge gateway totals into it.
      setCreatedTx(created);
      const amt = Number(totals.downpayment) || 0;
      let intent;
      try {
        intent = await paymentsService.createIntent({ transactionId: created.id, amount: amt });
      } catch (intentErr) {
        setCollectError(intentErr?.message || 'Could not start the online payment — collect the downpayment at pickup instead.');
        setSubmitting(false);
        submittingRef.current = false;
        setStep(4);
        return;
      }
      if (intent?.simulated) {
        setSubmitting(false);
        submittingRef.current = false;
        setStep(4);
        return;
      }
      setCollecting(true);
      if (intent?.gateway === 'maya') {
        setGatewayIntent(intent);
        setGatewayStatus('pending');
        if (intent.qrCodeBody) {
          try { setGatewayQrUrl(await QRCode.toDataURL(intent.qrCodeBody, { width: 220, margin: 1 })); }
          catch { setGatewayQrUrl(null); }
        }
        pollStopRef.current = false;
        const ok = await pollBookingPaid(created.id);
        finishOnlineCollect(created, ok);
        return;
      }
      try {
        await openDropIn(intent.clientKey, {
          amount: Math.round(amt * 100),
          currency: 'PHP',
          description: `Downpayment for ${selectedItem?.name || 'booking'}`,
        });
      } catch (payErr) {
        setCollecting(false);
        setCollectError(payErr?.message || 'Payment was cancelled — collect the downpayment at pickup instead.');
        setSubmitting(false);
        submittingRef.current = false;
        setStep(4);
        return;
      }
      setGatewayIntent(intent);
      setGatewayStatus('pending');
      pollStopRef.current = false;
      const ok = await pollBookingPaid(created.id);
      finishOnlineCollect(created, ok);
    } catch (err) {
      setError(err?.message || 'Failed to create rental. Please try again.');
      setCollecting(false);
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  // Polls until the downpayment credit lands (getStatus reports succeeded
  // once totalPaid covers the booking's downpayment). Resolves false on
  // timeout/failure/expiry so the caller can fall back to pickup collection.
  const pollBookingPaid = async (txId) => {
    for (let i = 0; i < 20; i++) {
      if (pollStopRef.current) return false;
      await new Promise((r) => setTimeout(r, 3000));
      if (pollStopRef.current) return false;
      try {
        const s = await paymentsService.getStatus(txId);
        setGatewayStatus(s?.status ?? null);
        if (s?.status === 'succeeded') {
          setCreatedTx((prev) => (prev ? { ...prev, totalPaid: s.totalPaid ?? prev.totalPaid, balance: s.balance ?? prev.balance } : prev));
          return true;
        }
        if (s?.status === 'failed' || s?.status === 'expired') return false;
      } catch { /* transient blip — keep polling */ }
    }
    return false;
  };

  const finishOnlineCollect = (created, ok) => {
    setCollecting(false);
    if (!ok) {
      setCollectError('Payment not confirmed yet — the booking is saved; collect the downpayment at pickup instead.');
    }
    // createdTx was seeded at creation and merged by the poller on success.
    setCreatedTx((prev) => prev ?? created);
    setSubmitting(false);
    submittingRef.current = false;
    setStep(4);
  };

  const buildBookingPayload = () => ({
    customer: customer.name,
    contact: customer.contact,
    address: customer.address,
    item: selectedItem.name,
    itemId: selectedItem.id,
    date: customer.rentalDate,
    amount: totals.discountedRate,
    downpayment: totals.downpayment,
    // Cash tab = money in hand, recorded as a completed payment with the
    // booking. Online tab = gateway webhook credits it when it lands.
    downpaymentCash: payChannel === 'cash',
    balance: totals.balance,
    discountPct: isDiscountApproved ? discountPct : 0,
    discountApprovedBy: isDiscountApproved ? discountAuthorized?.admin?.name || null : null,
    // Server-verified at booking (ignored without a staff session): the PIN
    // approval + the voucher code. Previously the counter discount never
    // reached the server at all (validation strips unknown fields).
    staffDiscountPct: isDiscountApproved ? discountPct : 0,
    staffDiscountPin: isDiscountApproved ? discountAuthorized?.pin || undefined : undefined,
    promoCode: promoApplied?.code || undefined,
    size,
    measurements,
    notes: customer.notes,
    rentalDate: customer.rentalDate,
    eventDate: customer.eventDate,
    returnDate: customer.returnDate,
  });

  const createBookingRecord = () => onAddTransaction(buildBookingPayload());

  const submitBooking = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    {
      try {
        const created = await createBookingRecord();
        setCreatedTx(created);
        setSubmitting(false);
        submittingRef.current = false;
        setStep(4);
      } catch (err) {
        setError(err?.message || 'Failed to create rental. Please try again.');
        setSubmitting(false);
        submittingRef.current = false;
      }
    }
  };

  // Progress labels for step indicator
  const progressSteps = ['Items', 'Details', 'Confirm', 'Receipt'];

  return (
    <>
      {/* interceptClose: while the form is dirty, backdrop/swipe hand
          control straight to the discard guard with NO exit animation —
          otherwise the sheet slides away under the confirm dialog and
          "Keep Editing" returns to an invisible sheet (looks like lost
          entries). When clean, the normal animated close plays. */}
      <BottomSheet onClose={() => requestNavigate('close')} interceptClose={hasUnsavedChanges} maxWidth="sm:max-w-3xl" labelledby="dialog-title-new-rental">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100/80">
          <h2 id="dialog-title-new-rental" className="text-xl font-bold text-gray-900">New Rental</h2>
          <button onClick={() => requestNavigate('close')} aria-label="Close new rental" className="p-1 text-gray-400 hover:bg-gray-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50">
            <X size={20} />
          </button>
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-center py-4 px-6 bg-gray-50/50">
          {progressSteps.map((label, idx) => (
            <div key={label} className="flex-1 flex flex-col items-center relative">
              <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border-2 ${
                step >= idx + 1 ? 'bg-[#bf4a53] border-[#bf4a53] text-white' : 'bg-white border-gray-200 text-gray-400'
              }`}>
                {idx + 1}
              </div>
              <span className={`text-[10px] font-bold mt-1 ${step >= idx + 1 ? 'text-[#bf4a53]' : 'text-gray-400'}`}>{label}</span>
              {idx < progressSteps.length - 1 && (
                <div className={`absolute top-4 left-1/2 w-full h-0.5 ${step > idx + 1 ? 'bg-[#bf4a53]' : 'bg-gray-200'}`}></div>
              )}
            </div>
          ))}
        </div>

        {/* Content area with scrollable catalog */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0 p-6">
          {/* STEP 1: Catalog */}
          {step === 1 && (
            <div key="step1" className="step-enter flex flex-col flex-1 min-h-0">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
                <div>
                  <h3 className="font-bold text-lg text-gray-900">Select Item</h3>
                  <p className="text-sm text-gray-500">Choose an available garment.</p>
                </div>
                <div className="relative w-full sm:w-48">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    type="text" placeholder="Search..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-8 py-2 bg-white border border-gray-200 rounded-full text-xs font-medium focus:outline-none focus:border-[#bf4a53]"
                  />
                  {searchQuery !== '' && (
                    <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Category filter — compact collapsible multi-select. Closed it is
                  a single row; options open in a dropdown with checkboxes. */}
              <div ref={catFilterRef} className="relative mb-3">
                {(() => {
                  const total = inventory.filter(i => i.status !== 'Deleted').length;
                  const names = selectedCategories.map(k => catalogCategories.find(c => c.key === k)?.label || k);
                  const summary = names.length === 0 ? 'All' : names.length <= 2 ? names.join(', ') : `${names[0]}, +${names.length - 1}`;
                  return (
                    <>
                      <button type="button" aria-expanded={catOpen} aria-controls="staff-cat-panel"
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
                        <div id="staff-cat-panel" role="group" aria-label="Choose categories"
                          className="absolute z-30 top-full mt-2 left-0 right-0 bg-white border border-gray-100 rounded-2xl shadow-xl p-1.5 max-h-64 overflow-y-auto">
                          <label className="flex min-h-[44px] items-center gap-3 px-3 py-1.5 rounded-xl cursor-pointer hover:bg-gray-50 focus-within:ring-2 focus-within:ring-[#bf4a53]/50">
                            <input type="checkbox" checked={selectedCategories.length === 0} onChange={() => setSelectedCategories([])}
                              aria-label={`All categories, ${total} items`} className="h-5 w-5 shrink-0 accent-[#bf4a53]" />
                            <span className="flex-1 text-sm font-semibold text-gray-900">All</span>
                            <span aria-hidden="true" className="text-[11px] font-bold text-gray-400 tabular-nums">{total}</span>
                          </label>
                          {catalogCategories.map(({ key, label }) => {
                            const count = inventory.filter(i => (i.category || '').toLowerCase() === key && i.status !== 'Deleted').length;
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

              {/* Scrollable catalog grid */}
              {fieldErrors.item && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl px-4 py-2.5 text-center mb-3">
                  {fieldErrors.item}
                </div>
              )}
              <div
                ref={catalogRef}
                onScroll={handleCatalogScroll}
                data-sheet-scroll
                className="flex-1 overflow-y-auto overscroll-contain pr-1 hide-scrollbar min-h-[240px] max-h-[36vh] sm:max-h-[44vh]"
              >
                {filteredCatalog.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center px-6 py-10 min-h-[220px]">
                    <Search size={28} className="text-gray-300 mb-2" />
                    <p className="text-sm font-bold text-gray-700">No items found</p>
                    <p className="text-xs text-gray-400 mt-1">Try a different search term or category.</p>
                    {(searchQuery.trim() !== '' || selectedCategories.length > 0) && (
                      <button
                        type="button"
                        onClick={() => { setSearchQuery(''); setSelectedCategories([]); }}
                        className="mt-3 px-4 py-2 rounded-full text-xs font-bold bg-gray-900 text-white hover:bg-gray-700 transition-colors"
                      >
                        Clear search &amp; filters
                      </button>
                    )}
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {displayedItems.map(item => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => { setSelectedItem(prev => prev?.id === item.id ? null : item); setSize(''); }}
                    aria-pressed={selectedItem?.id === item.id} aria-label={`Select ${item.name}, ${item.status}, ₱${item.price.toLocaleString()} per event`}
                    className={`bg-white rounded-2xl p-3 flex items-center gap-3 cursor-pointer border-2 transition-all text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/60 ${
                      selectedItem?.id === item.id ? 'border-[#bf4a53] shadow-md' : 'border-transparent hover:border-gray-200'
                    }`}
                  >
                    <ItemImage thumb image={item.image} alt="" className="w-12 h-12 rounded-xl object-cover bg-gray-100" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 line-clamp-1">{item.name}</p>
                      <p className="text-[10px] text-gray-500">₱{item.price.toLocaleString()}</p>
                      <span className={`inline-block mt-1 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                        item.status === 'Available'
                          ? 'bg-emerald-50 text-emerald-600'
                          : item.status === 'OutOfService'
                          ? 'bg-red-50 text-red-600'
                          : 'bg-amber-50 text-amber-600'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                    {selectedItem?.id === item.id && (
                      <svg className="w-5 h-5 text-[#bf4a53]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    )}
                  </button>
                  ))}
                </div>


                {/* Loader / show-more / end indicator */}
                <div className="py-3 flex justify-center">
                  {loadingMore && <Loader2 size={18} className="text-gray-400 animate-spin" />}
                  {!loadingMore && !allLoaded && (
                    <button
                      type="button"
                      onClick={loadMore}
                      className="px-5 py-2 rounded-full text-xs font-bold text-[#bf4a53] bg-red-50 hover:bg-red-100 active:scale-[0.98] transition-all"
                    >
                      Show more ({filteredCatalog.length - visibleCount} more)
                    </button>
                  )}
                  {!loadingMore && allLoaded && filteredCatalog.length > 0 && (
                    <p className="text-xs text-gray-400">All items loaded</p>
                  )}
                </div>
                </>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Details */}
          {step === 2 && (
            <div key="step2" ref={step2Ref} data-sheet-scroll className="step-enter overflow-y-auto min-h-0 pr-1 space-y-6">
              <h3 className="font-bold text-lg text-gray-900">Booking Details</h3>



              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-4 shadow-sm">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Customer</h4>
                <div>
                  <Field showLabel={false} type="text" placeholder="Full Name" value={customer.name}
                    onChange={e => { setCustomer({...customer, name: sanitizeName(e.target.value)}); clearFieldError('name'); touchField('name'); }}
                    onBlur={() => touchField('name')}
                    className={inputClass('name')} aria-label="Customer full name"
                    maxLength={INPUT_LIMITS.NAME_MAX}
                    error={fieldErrors.name || undefined} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Field showLabel={false} type="tel" placeholder="Contact No." value={customer.contact}
                      onChange={e => { setCustomer({...customer, contact: sanitizePhone(e.target.value)}); clearFieldError('contact'); touchField('contact'); }}
                      onBlur={() => touchField('contact')}
                      className={inputClass('contact')} inputMode="numeric" aria-label="Customer contact number"
                      maxLength={INPUT_LIMITS.PHONE_LENGTH}
                      error={fieldErrors.contact || undefined} />
                  </div>
                  <div>
                    <Field showLabel={false} type="text" placeholder="Address" value={customer.address}
                      onChange={e => { setCustomer({...customer, address: sanitizeAddress(e.target.value)}); clearFieldError('address'); touchField('address'); }}
                      onBlur={() => touchField('address')}
                      className={inputClass('address')} aria-label="Customer address"
                      maxLength={INPUT_LIMITS.ADDRESS_MAX}
                      error={fieldErrors.address || undefined} />
                  </div>
                </div>
                <div className="space-y-3">
                  <CollapsibleSection
                    icon={Calendar}
                    title="Rental Dates"
                    required={!customer.rentalDate || !customer.eventDate || !!fieldErrors.rentalDate}
                    summary={
                      customer.rentalDate && customer.eventDate
                        ? `${shortDate(customer.rentalDate)} → ${shortDate(customer.eventDate)}`
                        : customer.rentalDate
                          ? `${shortDate(customer.rentalDate)} → pick event day`
                          : 'Pick your dates'
                    }
                    hasError={!!(fieldErrors.rentalDate || fieldErrors.eventDate || (availability.available === false && !availability.checking))}
                  >
                    <DatePickGuide
                      hasPickup={!!customer.rentalDate}
                      hasEvent={!!customer.eventDate}
                      returnLabel={customer.returnDate
                        ? new Date(customer.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : null}
                    />
                    {(customer.rentalDate || customer.eventDate) && (
                      <div className="flex justify-end -mt-2">
                        <button
                          type="button"
                          onClick={() => handleCalendarChange('', '')}
                          className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[36px] text-[11px] font-bold text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                        >
                          <RotateCcw size={12} /> Reset dates
                        </button>
                      </div>
                    )}
                    <div className="grid gap-4 lg:grid-cols-[1fr_230px]">
                      <BookingCalendar
                        pickup={customer.rentalDate}
                        event={customer.eventDate}
                        bookedRanges={bookedRanges}
                        returnDays={returnDays}
                        hideSummary
                        onChange={handleCalendarChange}
                      />
                      <div className="space-y-3 min-w-0">
                        <ScheduleChips
                          pickup={customer.rentalDate}
                          event={customer.eventDate}
                          returnDays={returnDays}
                          vertical
                        />
                        <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-3 flex items-start gap-2">
                          <Calendar size={15} className="text-amber-500 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-amber-800">Pickup before the event</p>
                            <p className="text-[11px] text-amber-600/80 mt-0.5">Return due {returnDays === 1 ? 'the day after' : `${returnDays} days after`} the event{customer.returnDate ? ` (${new Date(customer.returnDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})})` : ''}.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    {fieldErrors.rentalDate && <p className="text-[11px] text-red-500 font-medium mt-1 ml-1">{fieldErrors.rentalDate}</p>}
                    {fieldErrors.eventDate && <p role="alert" className="text-[11px] text-red-500 font-medium mt-1 ml-1">{fieldErrors.eventDate}</p>}
                    {availability.checking && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Loader2 size={14} className="animate-spin" /> Checking availability…
                      </div>
                    )}
                    {!availability.checking && availability.available === true && (
                      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                        <Check size={16} /> Available for the selected dates.
                      </div>
                    )}
                    {!availability.checking && availability.available === false && (
                      <div className="flex items-center gap-2 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
                        <Calendar size={16} /> {availability.reason || 'Not available for the selected dates.'}
                      </div>
                    )}
                  </CollapsibleSection>
                </div>
              </div>

              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-4 shadow-sm">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Item: {selectedItem?.name}</h4>
                <div>
                  <select value={size} onChange={e => { setSize(e.target.value); clearFieldError('size'); touchField('size'); }}
                    onBlur={() => touchField('size')}
                    className={inputClass('size')}>
                    <option value="">-- Select Size --</option>
                    {['XS','S','M','L','XL','XXL','Custom / Measurements'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {fieldErrors.size && <p className="text-[11px] text-red-500 font-medium mt-1 ml-1">{fieldErrors.size}</p>}
                </div>

                {size === 'Custom / Measurements' && (
                  <div className="pt-4 border-t border-gray-100">
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
                            onChange={e => setMeasurements({...measurements, [field]: e.target.value})}
                            className="w-full p-2.5 bg-gray-50 rounded-xl border text-xs focus:outline-none focus:border-[#bf4a53]" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {fieldErrors.measurements && <p className="text-[11px] text-red-500 font-medium mt-1 ml-1">{fieldErrors.measurements}</p>}
              </div>

              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-3 shadow-sm">
                <div>
                  <p className="font-bold text-sm text-gray-900">Downpayment <span className="text-[#bf4a53]">*</span></p>
                  <p className="text-xs text-gray-500">Required — minimum ₱{Math.min(minDownpayment || 200, totals.discountedRate || 0).toLocaleString()} to secure the booking</p>
                </div>
                <div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">₱</span>
                    <input type="number" placeholder="Amount" value={downpaymentAmount}
                      onChange={e => { setDownpaymentAmount(e.target.value); clearFieldError('downpayment'); touchField('downpayment'); }}
                      onBlur={() => touchField('downpayment')}
                      className={inputClass('downpayment', 'pl-8')} aria-label="Required downpayment amount" />
                  </div>
                  {fieldErrors.downpayment && <p className="text-[11px] text-red-500 font-medium mt-1 ml-1">{fieldErrors.downpayment}</p>}
                </div>
              </div>

              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-4 shadow-sm">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Documentation</h4>
                <textarea placeholder="Remarks / Notes" value={customer.notes}
                  onChange={e => setCustomer({...customer, notes: sanitizeNotes(e.target.value)})}
                  maxLength={INPUT_LIMITS.NOTES_MAX}
                  className="w-full p-3 bg-gray-50 rounded-xl border text-sm min-h-[80px] focus:outline-none focus:border-[#bf4a53]" />
              </div>
            </div>
          )}

          {/* STEP 3: Receipt */}
          {step === 3 && (
            <div key="step3" data-sheet-scroll className="step-enter overflow-y-auto min-h-0 pr-1 space-y-4">
              <div className="text-center">
                <p className="text-[11px] font-extrabold text-[#bf4a53] uppercase tracking-[0.14em]">Step 3 of 3 · Review</p>
                <h3 className="text-lg font-bold text-gray-900 mt-0.5">Review Transaction</h3>
                <p className="text-sm text-gray-500">Check everything before confirming the rental.</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="flex items-center gap-4 p-4 sm:p-5 bg-gradient-to-br from-red-50/70 via-white to-white border-b border-red-100/60">
                  <ItemImage thumb image={selectedItem?.image} alt={selectedItem?.name || 'Item photo'} className="w-16 h-16 rounded-2xl object-cover bg-gray-100 shadow-sm shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-gray-900 leading-snug truncate">{selectedItem?.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {selectedItem?.category && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">{selectedItem.category}</span>
                      )}
                      {!!size && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-[#bf4a53] bg-[#bf4a53]/10 rounded-full px-2.5 py-1">Size {size}</span>
                      )}
                    </div>
                  </div>
                  <span title="Ready to confirm" className="shrink-0 w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <Check size={18} strokeWidth={3} />
                  </span>
                </div>
                <div className="grid grid-cols-3 divide-x divide-gray-100 bg-gray-50/60">
                  {[
                    { label: 'Pickup', value: customer.rentalDate },
                    { label: 'Event', value: customer.eventDate },
                    { label: 'Return', value: customer.returnDate },
                  ].map(({ label, value }) => (
                    <div key={label} className="px-2 py-2.5 text-center min-w-0">
                      <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-gray-400">{label}</p>
                      <p className="text-xs font-extrabold text-gray-900 mt-0.5 truncate">
                        {value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="p-5 space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Customer</span><span className="font-semibold">{customer.name}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Pickup</span><span className="font-semibold">{new Date(customer.rentalDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Event Date</span><span className="font-semibold">{new Date(customer.eventDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Return By</span><span className="font-semibold">{new Date(customer.returnDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}</span></div>
                  <div className="flex justify-between font-bold"><span>{selectedItem?.name}</span><span>₱{totals.baseRate.toLocaleString()}</span></div>
                  {totals.promoDiscount > 0 && (
                    <div className="flex justify-between text-emerald-600"><span>Voucher ({totals.promoCode})</span><span>-₱{totals.promoDiscount.toLocaleString()}</span></div>
                  )}
                  {totals.discount > 0 && (
                    <div className="flex justify-between text-emerald-600"><span>Discount ({discountPct}%)</span><span>-₱{totals.discount.toLocaleString()}</span></div>
                  )}
                  {(totals.discount > 0 || totals.promoDiscount > 0) && (
                    <div className="flex justify-between text-sm"><span className="text-gray-500">After Discount</span><span className="font-semibold">₱{totals.discountedRate.toLocaleString()}</span></div>
                  )}
                  <div className="flex justify-between border-t pt-3 mt-2"><span className="text-gray-500">Balance (remaining)</span><span className="font-bold text-gray-900">₱{totals.balance.toLocaleString()}</span></div>
                  {totals.downpayment > 0 && (
                    <div className="overflow-hidden rounded-2xl bg-white border-2 border-[#bf4a53] shadow-[0_4px_14px_-10px_rgba(191,74,83,0.35)]">
                      <div className="px-4 pt-3.5 pb-3 flex items-end justify-between gap-3">
                        <div className="min-w-0">
                          <span className="inline-block text-[9px] font-extrabold uppercase tracking-[0.14em] text-white bg-[#bf4a53] rounded-full px-2 py-0.5">Due now</span>
                          <p className="text-sm font-bold text-gray-900 mt-1.5">Paying now <span className="font-medium text-gray-400">(downpayment)</span></p>
                        </div>
                        <p className="font-extrabold text-[#bf4a53] text-2xl leading-none tabular-nums shrink-0">₱{totals.downpayment.toLocaleString()}</p>
                      </div>
                      <div className="mx-4 h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                        <div
                          className="h-full rounded-full bg-[#bf4a53] transition-all"
                          style={{ width: `${totals.discountedRate > 0 ? Math.min(100, Math.round((totals.downpayment / totals.discountedRate) * 100)) : 0}%` }}
                        />
                      </div>
                      <div className="mt-3 px-4 py-2.5 bg-red-50/70 border-t border-red-100 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-gray-500">Balance due at pickup</span>
                        <span className="text-sm font-extrabold text-gray-900 tabular-nums">₱{Math.max(0, totals.balance).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                  {totals.balance > 0 && (
                    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-4 py-3">
                      <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                        <Banknote size={17} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-amber-800 tabular-nums">₱{totals.balance.toLocaleString()} to collect at pickup</p>
                        <p className="text-[11px] text-amber-700 leading-snug mt-0.5">Collect the rest at handover — release the item only once fully paid.</p>
                      </div>
                    </div>
                  )}
                  {discountPct > 0 && (
                    isDiscountApproved ? (
                      <p className="text-[10px] text-emerald-600 font-medium text-center pt-1">Discount approved by {discountAuthorized.admin?.name}</p>
                    ) : (
                      <p className="text-[10px] text-amber-600 font-medium text-center pt-1">Discount needs admin approval at confirmation</p>
                    )
                  )}
                  {customer.notes && <p className="text-xs text-gray-500 italic mt-2">Notes: {customer.notes}</p>}
                </div>
</div>

              {/* Payment — how the ₱{totals.downpayment} downpayment is collected.
                  Cash records it with the booking; Online charges it through the
                  gateway right after the booking is created (receipt lands only
                  after the gateway confirms). */}
              <div className="bg-white rounded-2xl shadow-sm border p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-bold text-sm text-gray-900">Payment</h4>
                  <span className="text-xs font-bold text-[#bf4a53] bg-red-50 rounded-full px-3 py-1.5">₱{totals.downpayment.toLocaleString()} downpayment</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-2xl" role="tablist" aria-label="Downpayment channel">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={payChannel === 'cash'}
                    onClick={() => setPayChannel('cash')}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-1.5 ${payChannel === 'cash' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                  >
                    <Banknote size={14} /> Cash
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={payChannel === 'online'}
                    onClick={() => setPayChannel('online')}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-1.5 ${payChannel === 'online' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                  >
                    {gateway === 'paymongo' ? <CreditCard size={14} /> : <QrCode size={14} />} Online
                  </button>
                </div>
                {payChannel === 'cash' ? (
                  <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-xl px-3.5 py-3">
                    Collect <span className="font-bold text-gray-900">₱{totals.downpayment.toLocaleString()} in cash</span> at the counter — it is recorded with the booking. The remaining ₱{totals.balance.toLocaleString()} is settled at pickup.
                  </p>
                ) : gateway === 'manual' ? (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500 leading-relaxed bg-blue-50/70 border border-blue-100 rounded-xl px-3.5 py-3">
                      Collect <span className="font-bold text-gray-900">₱{totals.downpayment.toLocaleString()} via InstaPay QR</span> — show the QR to the customer, then Confirm to record the verified payment.
                    </p>
                    <ManualQrPanel
                      qrCodes={manualQrCodes}
                      channel={manualChannel}
                      onChannelChange={setManualChannel}
                      note="Verify the transfer in your payment app before confirming."
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500 leading-relaxed bg-blue-50/70 border border-blue-100 rounded-xl px-3.5 py-3">
                      {gateway === 'maya'
                        ? <>Charge <span className="font-bold text-gray-900">₱{totals.downpayment.toLocaleString()} via Maya QRPh</span> — after Confirm, show the QR to the customer to scan. The receipt lands only after Maya confirms.</>
                        : <>Charge <span className="font-bold text-gray-900">₱{totals.downpayment.toLocaleString()} via PayMongo</span> (GCash / card) — after Confirm, the secure checkout opens on this device. The receipt lands only after the payment succeeds.</>}
                    </p>
                    {collecting && gatewayIntent?.gateway === 'maya' && (
                      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col items-center gap-2">
                        {gatewayQrUrl
                          ? <img src={gatewayQrUrl} alt="Maya payment QR" className="w-44 h-44 rounded-xl border border-gray-100" />
                          : <QrCode size={40} className="text-gray-300" />}
                        {gatewayIntent.redirectUrl && (
                          <a href={gatewayIntent.redirectUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-bold text-[#bf4a53] hover:underline">
                            <ExternalLink size={12} /> Open Maya checkout
                          </a>
                        )}
                        <p className="text-[11px] font-bold text-amber-600 animate-pulse flex items-center gap-1.5">
                          <Loader2 size={12} className="animate-spin" /> Waiting for customer payment…
                        </p>
                      </div>
                    )}
                    {collecting && gatewayIntent?.gateway !== 'maya' && (
                      <p className="text-[11px] font-bold text-amber-600 animate-pulse flex items-center gap-1.5">
                        <Loader2 size={12} className="animate-spin" /> Waiting for payment confirmation…
                      </p>
                    )}
                  </div>
                )}
                {collectError && <p className="text-xs text-red-500 font-medium bg-red-50 rounded-xl px-3.5 py-2.5">{collectError}</p>}
              </div>

              {/* Discount — staff picks the %; the admin approves that exact
                  amount with their PIN when Confirm is pressed (not before). */}
              <div className="bg-white rounded-2xl shadow-sm border p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <Percent size={15} />
                    </span>
                    <div>
                      <h4 className="font-bold text-sm text-gray-900">Discount</h4>
                      <p className="text-[11px] text-gray-400">Admin approves it at confirmation</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-extrabold rounded-full px-3 py-1.5 ${discountPct > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>{discountPct}%</span>
                    {discountPct > 0 && (
                      <button onClick={() => { handleDiscountChange(0); }}
                        className="text-xs font-bold text-red-500 hover:underline">
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <input type="range" min={0} max={50} value={discountPct}
                      onChange={e => handleDiscountChange(Number(e.target.value))}
                      disabled={isDiscountApproved}
                      className="flex-1 accent-[#bf4a53] disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Discount percent" />
                    <span className="text-sm font-bold text-gray-900 w-12 text-right">{discountPct}%</span>
                  </div>
                  {discountPct > 0 && (
                    isDiscountApproved ? (
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-emerald-600 font-medium">
                        <ShieldCheck size={12} />
                        Approved by {discountAuthorized.admin?.name} — {discountPct}% (₱{totals.discount.toLocaleString()} off) · locked (Remove to change)
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] text-amber-600 font-medium">
                        {discountPct}% (₱{totals.discount.toLocaleString()} off) — an admin will approve this exact amount when you confirm the order.
                      </p>
                    )
                  )}
                </div>
                {/* Voucher — same server-side codes as the customer flow,
                    validated against this item's price + category. */}
                <div className="pt-3 border-t border-gray-100">
                  {!promoApplied ? (
                    <>
                      <div className="flex gap-2">
                        <input type="text" value={promoCode}
                          onChange={e => { setPromoCode(e.target.value.toUpperCase()); if (promoError) setPromoError(''); }}
                          placeholder="Voucher code (optional)" maxLength={20}
                          aria-label="Voucher code"
                          className="flex-1 min-w-0 p-2.5 bg-gray-50 rounded-xl border border-gray-200 text-sm font-bold uppercase placeholder:normal-case placeholder:font-medium placeholder:text-gray-400 focus:outline-none focus:border-[#bf4a53]" />
                        <button type="button" onClick={() => handleApplyPromo()} disabled={!promoCode.trim() || promoApplying}
                          className="px-4 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition-colors disabled:opacity-50 shrink-0">
                          {promoApplying ? '…' : 'Apply'}
                        </button>
                      </div>
                      {promoError && <p className="text-xs text-red-500 font-medium mt-1.5">{promoError}</p>}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                      <p className="flex-1 min-w-0 text-xs font-bold text-emerald-800 truncate">
                        {promoApplied.code} <span className="font-semibold text-emerald-600">· {promoDiscountLabel(promoApplied)}</span>
                      </p>
                      <button type="button" onClick={clearPromo} className="text-xs text-gray-400 hover:text-red-500 font-semibold shrink-0">
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* STEP 4: Receipt (post-booking with scannable QR for the customer) */}
          {step === 4 && createdTx && (
            <div key="step4" data-sheet-scroll className="step-enter overflow-y-auto min-h-0 pr-1 space-y-4">
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={28} className="text-emerald-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">Rental Created</h3>
                <p className="text-sm text-gray-500">Show this receipt to the customer. They can show the QR at pickup.</p>
              </div>
              {collectError && (
                <p className="text-xs text-amber-700 font-medium bg-amber-50 border border-amber-200/70 rounded-2xl px-4 py-2.5 text-center">{collectError}</p>
              )}
              <div className="print-area">
                <BookingReceipt
                  tx={createdTx}
                  pickupLabel={new Date(customer.rentalDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}
                  eventLabel={new Date(customer.eventDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}
                  dueLabel={new Date(customer.returnDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="p-4 border-t bg-gray-50/50 flex gap-3">
          {error && (
            <div className="absolute bottom-16 left-4 right-4 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl px-4 py-2.5 text-center">
              {error}
            </div>
          )}
          {step === 4 ? (
            <>
              <button
                onClick={() => downloadReceiptImage({
                  tx: createdTx,
                  itemName: selectedItem?.name,
                  customerName: customer.name,
                  pickupLabel: new Date(customer.rentalDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}),
                  eventLabel: new Date(customer.eventDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}),
                  dueLabel: new Date(customer.returnDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}),
                  notes: customer.notes || null,
                  showQr: flags.qr_codes,
                })}
                className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 no-print"
              >
                <Download size={16} /> Save Receipt
              </button>
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-full font-bold text-sm bg-gray-900 text-white hover:bg-gray-800 transition-colors shadow">
                Done
              </button>
            </>
          ) : (
            <>
              <button onClick={() => requestNavigate('back')} className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
                Back
              </button>
              <button
                onClick={handleNext}
                disabled={submitting || collecting || (step >= 2 && (availability.checking || availability.available === false))}
                className="flex-[2] py-2.5 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 transition-colors shadow flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting || collecting ? <Loader2 size={16} className="animate-spin" /> : null}
                {step === 3 ? (collecting ? 'Collecting…' : submitting ? 'Processing…' : payChannel === 'online' ? (gateway === 'manual' ? 'Create & Record Payment' : 'Create & Collect Online') : 'Confirm & Process') : availability.checking ? 'Checking…' : 'Continue'}
              </button>
            </>
          )}
        </div>
      </BottomSheet>

      {/* Discard-changes confirm — Back / X / backdrop / Escape with unsaved entries */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[260] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowDiscardConfirm(false); setConfirmNav(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-discard-rental" className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h4 id="dialog-title-discard-rental" className="font-bold text-lg text-gray-900">Discard changes?</h4>
            <p className="text-sm text-gray-500">You have unsaved entries in this rental. Leaving now will lose them.</p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setShowDiscardConfirm(false); setConfirmNav(null); }}
                className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                Keep Editing
              </button>
              <button
                onClick={confirmDiscard}
                className="flex-1 py-2.5 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Auth Modal (at top level to avoid transform breaking fixed) */}
      {showAdminAuth && (
        <div className="fixed inset-0 z-[250] bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowAdminAuth(false)}>
          <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-admin-auth" className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4 pointer-events-auto" onClick={e => e.stopPropagation()}>
            <h4 id="dialog-title-admin-auth" className="font-bold text-gray-900">Admin Authorization</h4>
            <p className="text-xs text-gray-500">
              {discountPct > 0
                ? <>Approve a <strong className="text-gray-900">{discountPct}% discount (₱{totals.discount.toLocaleString()} off)</strong> on <strong className="text-gray-900">{selectedItem?.name}</strong>? Enter the admin's 4-digit PIN to lock it in — then press Confirm again to process the order.</>
                : <>Enter the admin's 4-digit PIN to apply a discount.</>}
            </p>
            {authError && <p className="text-xs text-red-500 font-medium bg-red-50 p-3 rounded-xl">{authError}</p>}
            <input type="password" inputMode="numeric" placeholder="••••" maxLength={4}
              value={adminPin}
              onChange={e => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={e => { if (e.key === 'Enter') handleAuthorize(); }}
              className="w-full p-3 bg-gray-50 rounded-xl border text-center text-2xl font-bold tracking-[0.5em] text-gray-900 focus:outline-none focus:border-[#bf4a53] focus:ring-2 focus:ring-[#bf4a53]/15" />
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAdminAuth(false); setAuthError(''); setAdminPin(''); }}
                className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleAuthorize} disabled={authLoading || adminPin.length !== 4}
                className="flex-[2] py-2.5 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {authLoading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {authLoading ? 'Verifying...' : 'Authorize'}
              </button>
            </div>
                </div>
              </div>
            </div>
          )}
    </>
  );
}
