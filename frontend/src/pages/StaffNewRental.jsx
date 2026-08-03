import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Loader2, Search, Calendar, User, Check, Percent, ShieldCheck } from 'lucide-react';
import { api } from '../utils/api';
import ItemImage from '../components/ItemImage';
import BookingCalendar from '../components/BookingCalendar';
import Field from '../components/ui/Field';
import { inventoryService } from '../services/inventory';
import { useEscapeClose } from '../hooks/useEscapeClose';

const ITEMS_PER_LOAD = 6;

const toLocalYmd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export default function StaffNewRental({ inventory, transactions = [], onAddTransaction, onClose, initialItem }) {
  useEscapeClose(onClose);

  // Steps
  const [step, setStep] = useState(initialItem ? 2 : 1);

  // Catalog search & filter
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_LOAD);
  const [loadingMore, setLoadingMore] = useState(false);
  const catalogRef = useRef(null);

  // Selected item (only one at a time)
  const [selectedItem, setSelectedItem] = useState(initialItem || null);

  // Customer lookup from past transactions
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const customerSearchRef = useRef(null);

  const foundCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    const q = customerSearch.toLowerCase();
    const seen = new Set();
    const results = [];
    for (const tx of transactions) {
      if (results.length >= 5) break;
      if (tx.customer && !seen.has(tx.customer) && tx.customer.toLowerCase().includes(q)) {
        seen.add(tx.customer);
        results.push({ name: tx.customer, contact: tx.contact || '', address: tx.address || '' });
      }
    }
    return results;
  }, [customerSearch, transactions]);

  const selectCustomer = (c) => {
    setCustomer({ ...customer, name: c.name, contact: c.contact, address: c.address });
    setCustomerSearch(c.name);
    setShowCustomerResults(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (customerSearchRef.current && !customerSearchRef.current.contains(e.target)) {
        setShowCustomerResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

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
      ret.setDate(ret.getDate() + 1);
      updated.returnDate = toLocalYmd(ret);
    }
    setCustomer(updated);
    setFieldErrors((prev) => ({ ...prev, rentalDate: '', eventDate: '' }));
  };

  const handleRentalDateChange = (d) => {
    const updated = { ...customer, rentalDate: d };
    if (d > customer.eventDate) {
      const ret = new Date(d);
      ret.setDate(ret.getDate() + 1);
      updated.eventDate = d;
      updated.returnDate = ret.toISOString().split('T')[0];
    }
    setCustomer(updated);
  };

  // Customer details
  const [customer, setCustomer] = useState(() => {
    const now = new Date();
    const eventD = new Date(now.getTime() + 2 * 86400000);
    const returnD = new Date(eventD.getTime() + 1 * 86400000);
    return {
      name: '', contact: '', address: '',
      rentalDate: now.toISOString().split('T')[0],
      eventDate: eventD.toISOString().split('T')[0],
      returnDate: returnD.toISOString().split('T')[0],
      notes: '',
      photoUrl: null,
    };
  });

  // Downpayment
  const [includeDownpayment, setIncludeDownpayment] = useState(false);
  const [downpaymentAmount, setDownpaymentAmount] = useState('');

  // Discount (requires admin approval)
  const [discountPct, setDiscountPct] = useState(0);
  const [discountAuthorized, setDiscountAuthorized] = useState(null);
  const [showAdminAuth, setShowAdminAuth] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // When event date changes, auto-update return date to next day
  const handleEventDateChange = (d) => {
    const ret = new Date(d);
    ret.setDate(ret.getDate() + 1);
    setCustomer({ ...customer, eventDate: d, returnDate: ret.toISOString().split('T')[0] });
  };

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
    if (!customer.name || customer.name.trim().length < 2) errs.name = 'Full name is required (min 2 characters)';
    if (!customer.contact || !/^\d{11}$/.test(customer.contact.trim())) errs.contact = 'Contact number must be exactly 11 digits';
    if (!customer.address || customer.address.trim().length < 5) errs.address = 'Address is required (min 5 characters)';
    if (new Date(customer.rentalDate) < new Date(todayStr)) errs.rentalDate = 'Pickup date cannot be in the past';
    if (new Date(customer.eventDate) < new Date(customer.rentalDate)) errs.eventDate = 'Event date must be on or after pickup date';
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
    if (includeDownpayment) {
      const dp = Number(downpaymentAmount) || 0;
      if (dp <= 0) errs.downpayment = 'Downpayment amount must be greater than 0';
      if (dp > totals.baseRate) errs.downpayment = 'Downpayment cannot exceed the rental fee';
    }
    setFieldErrors(errs);
    setTouchedFields(prev => ({ ...prev, ...Object.fromEntries(Object.keys(errs).map(k => [k, true])) }));
    return Object.keys(errs).length === 0;
  };

  // Derived totals
  const totals = useMemo(() => {
    const base = selectedItem?.price || 0;
    const discountAmt = discountAuthorized ? Math.round(base * (discountPct / 100)) : 0;
    const afterDiscount = base - discountAmt;
    const dp = includeDownpayment ? (Number(downpaymentAmount) || 0) : 0;
    return { baseRate: base, discount: discountAmt, discountedRate: afterDiscount, downpayment: dp, balance: afterDiscount - dp };
  }, [selectedItem, includeDownpayment, downpaymentAmount, discountPct, discountAuthorized]);

  // Live field validity (green glow when valid)
  const fieldValid = useMemo(() => {
    const v = {};
    if (customer.name?.trim().length >= 2) v.name = true;
    if (/^\d{11}$/.test(customer.contact?.trim())) v.contact = true;
    if (customer.address?.trim().length >= 5) v.address = true;
    if (customer.rentalDate && new Date(customer.rentalDate) >= new Date(todayStr)) v.rentalDate = true;
    if (customer.eventDate && customer.rentalDate && new Date(customer.eventDate) >= new Date(customer.rentalDate)) v.eventDate = true;
    if (size) v.size = true;
    if (size === 'Custom / Measurements' && measurementsExpanded) {
      const filled = measurementFields.filter(f => measurements[f] && String(measurements[f]).trim());
      if (filled.length >= 3) v.measurements = true;
    } else if (size && size !== 'Custom / Measurements') {
      v.measurements = true;
    }
    if (includeDownpayment) {
      const dp = Number(downpaymentAmount) || 0;
      if (dp > 0 && dp <= totals.baseRate) v.downpayment = true;
    } else {
      v.downpayment = true;
    }
    return v;
  }, [customer, todayStr, size, measurementsExpanded, measurements, measurementFields, includeDownpayment, downpaymentAmount, totals.baseRate]);

  // Filtered catalog (staff can pick any bookable item, including ones that are
  // currently Rented/Reserved — so they can reserve a future-free date). Deleted
  // items are excluded since they're removed from the catalog.
  const filteredCatalog = useMemo(() => {
    const cats = {
      all: () => true,
      gown: i => i.category?.toLowerCase() === 'gown',
      suit: i => i.category?.toLowerCase() === 'suit',
      formal: i => i.category?.toLowerCase() === 'formal',
    };
    return inventory.filter(item => {
      if (item.status === 'Deleted') return false;
      const matchesCat = cats[activeCategory] ? cats[activeCategory](item) : true;
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [inventory, activeCategory, searchQuery]);

  // Reset visibleCount when filters change
  useEffect(() => {
    setVisibleCount(ITEMS_PER_LOAD);
    setLoadingMore(false);
  }, [activeCategory, searchQuery]);

  // Slice the items for display
  const displayedItems = filteredCatalog.slice(0, visibleCount);
  const allLoaded = visibleCount >= filteredCatalog.length;

  // Infinite scroll handler
  const handleCatalogScroll = useCallback(() => {
    const el = catalogRef.current;
    if (!el || loadingMore || allLoaded) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setLoadingMore(true);
      // Simulate network
      setTimeout(() => {
        setVisibleCount(prev => Math.min(prev + ITEMS_PER_LOAD, filteredCatalog.length));
        setLoadingMore(false);
      }, 400);
    }
  }, [loadingMore, allLoaded, filteredCatalog.length]);

  // Navigation helpers
  const handleBack = () => {
    if (step > 1) setStep(s => s - 1);
    else onClose();
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
      submittingRef.current = true;
      setSubmitting(true);
      const transactionData = {
        customer: customer.name,
        contact: customer.contact,
        address: customer.address,
        item: selectedItem.name,
        itemId: selectedItem.id,
        date: customer.rentalDate,
        amount: totals.discountedRate,
        downpayment: totals.downpayment,
        balance: totals.balance,
        discountPct: discountAuthorized ? discountPct : 0,
        discountApprovedBy: discountAuthorized?.name || null,
        size,
        measurements,
        notes: customer.notes,
        rentalDate: customer.rentalDate,
        eventDate: customer.eventDate,
        returnDate: customer.returnDate,
      };
      try {
        await onAddTransaction(transactionData);
        setTimeout(() => onClose(), 1200);
      } catch (err) {
        setError(err?.message || 'Failed to create rental. Please try again.');
        setSubmitting(false);
        submittingRef.current = false;
      }
      return;
    }
    setStep(s => s + 1);
  };

  // Progress labels for step indicator
  const progressSteps = ['Items', 'Details', 'Confirm'];

  return (
    <div className="fixed inset-0 z-[200] bg-gray-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-new-rental" className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-300 pointer-events-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100/80">
          <h2 id="dialog-title-new-rental" className="text-xl font-bold text-gray-900">New Rental</h2>
          <button onClick={onClose} aria-label="Close new rental" className="p-1 text-gray-400 hover:bg-gray-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/50">
            <X size={20} />
          </button>
        </div>

        {/* Progress steps */}
        <div className="flex items-center justify-center py-4 px-6 bg-gray-50/50">
          {progressSteps.map((label, idx) => (
            <div key={label} className="flex-1 flex flex-col items-center relative">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border-2 ${
                step >= idx + 1 ? 'bg-[#bf4a53] border-[#bf4a53] text-white' : 'bg-white border-gray-200 text-gray-400'
              }`}>
                {idx + 1}
              </div>
              <span className={`text-[10px] font-bold mt-1 ${step >= idx + 1 ? 'text-[#bf4a53]' : 'text-gray-400'}`}>{label}</span>
              {idx < 2 && (
                <div className={`absolute top-4 left-1/2 w-full h-0.5 ${step > idx + 1 ? 'bg-[#bf4a53]' : 'bg-gray-200'}`}></div>
              )}
            </div>
          ))}
        </div>

        {/* Content area with scrollable catalog */}
        <div className="flex-1 overflow-hidden flex flex-col p-6">
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
                    className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-full text-xs font-medium focus:outline-none focus:border-[#bf4a53]"
                  />
                </div>
              </div>

              {/* Category tabs */}
              <div className="flex gap-2 flex-wrap mb-4">
                {['all','gown','suit','formal'].map(cat => (
                  <button key={cat} onClick={() => setActiveCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap border ${
                      activeCategory === cat ? 'bg-[#bf4a53] text-white border-[#bf4a53]' : 'bg-white border-gray-200 text-gray-600'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
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
                className="flex-1 overflow-y-auto pr-1 hide-scrollbar"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {displayedItems.map(item => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => { setSelectedItem(prev => prev?.id === item.id ? null : item); setSize(''); }}
                    aria-pressed={selectedItem?.id === item.id} aria-label={`Select ${item.name}, ${item.status}, ₱${item.price.toLocaleString()} per day`}
                    className={`bg-white rounded-2xl p-3 flex items-center gap-3 cursor-pointer border-2 transition-all text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bf4a53]/60 ${
                      selectedItem?.id === item.id ? 'border-[#bf4a53] shadow-md' : 'border-transparent hover:border-gray-200'
                    }`}
                  >
                    <ItemImage image={item.image} alt="" className="w-12 h-12 rounded-xl object-cover bg-gray-100" />
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

                {/* Loader / end indicator */}
                <div className="py-3 flex justify-center">
                  {loadingMore && <Loader2 size={18} className="text-gray-400 animate-spin" />}
                  {!loadingMore && allLoaded && filteredCatalog.length > 0 && (
                    <p className="text-xs text-gray-400">All items loaded</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Details */}
          {step === 2 && (
            <div key="step2" ref={step2Ref} className="step-enter overflow-y-auto pr-1 space-y-6">
              <h3 className="font-bold text-lg text-gray-900">Booking Details</h3>



              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-4 shadow-sm">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Customer</h4>
                <div ref={customerSearchRef} className="relative">
                  <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Search past customers or enter new name..."
                      value={customerSearch}
                      onChange={e => { setCustomerSearch(e.target.value); setShowCustomerResults(true); }}
                      onFocus={() => setShowCustomerResults(true)}
                      className="w-full pl-9 p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]" />
                  </div>
                  {showCustomerResults && foundCustomers.length > 0 && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-gray-100 rounded-2xl shadow-lg z-10 overflow-hidden">
                      {foundCustomers.map((c, i) => (
                        <button key={i}
                          onClick={() => selectCustomer(c)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                        >
                          <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                            <User size={14} className="text-[#bf4a53]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate">{c.name}</p>
                            {c.contact && <p className="text-[11px] text-gray-500">{c.contact}</p>}
                          </div>
                          <Check size={14} className="text-emerald-500 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <Field showLabel={false} type="text" placeholder="Full Name" value={customer.name}
                    onChange={e => { setCustomer({...customer, name: e.target.value}); clearFieldError('name'); touchField('name'); }}
                    onBlur={() => touchField('name')}
                    className={inputClass('name')} aria-label="Customer full name"
                    error={fieldErrors.name || undefined} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Field showLabel={false} type="tel" placeholder="Contact No." value={customer.contact}
                      onChange={e => { setCustomer({...customer, contact: e.target.value.replace(/\D/g, '')}); clearFieldError('contact'); touchField('contact'); }}
                      onBlur={() => touchField('contact')}
                      className={inputClass('contact')} inputMode="numeric" aria-label="Customer contact number"
                      error={fieldErrors.contact || undefined} />
                  </div>
                  <div>
                    <Field showLabel={false} type="text" placeholder="Address" value={customer.address}
                      onChange={e => { setCustomer({...customer, address: e.target.value}); clearFieldError('address'); touchField('address'); }}
                      onBlur={() => touchField('address')}
                      className={inputClass('address')} aria-label="Customer address"
                      error={fieldErrors.address || undefined} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Rental Dates</label>
                  <BookingCalendar
                    pickup={customer.rentalDate}
                    event={customer.eventDate}
                    bookedRanges={bookedRanges}
                    onChange={handleCalendarChange}
                  />
                  {fieldErrors.rentalDate && <p className="text-[11px] text-red-500 font-medium mt-1 ml-1">{fieldErrors.rentalDate}</p>}
                </div>
                <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-3 flex items-start gap-2">
                  <Calendar size={16} className="text-amber-500 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-amber-800">Pick up before your event date</p>
                    <p className="text-[11px] text-amber-600/80 mt-0.5">Return due the day after your event ({new Date(customer.returnDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}).</p>
                  </div>
                </div>
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
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-sm text-gray-900">Downpayment</p>
                    <p className="text-xs text-gray-500">Optional partial payment</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={includeDownpayment} onChange={e => setIncludeDownpayment(e.target.checked)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#bf4a53]"></div>
                  </label>
                </div>
                {includeDownpayment && (
                  <div>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">₱</span>
                      <input type="number" placeholder="Amount" value={downpaymentAmount}
                        onChange={e => { setDownpaymentAmount(e.target.value); clearFieldError('downpayment'); touchField('downpayment'); }}
                        onBlur={() => touchField('downpayment')}
                        className={inputClass('downpayment', 'pl-8')} />
                    </div>
                    {fieldErrors.downpayment && <p className="text-[11px] text-red-500 font-medium mt-1 ml-1">{fieldErrors.downpayment}</p>}
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-100/80 rounded-2xl p-5 space-y-4 shadow-sm">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Documentation</h4>
                <textarea placeholder="Remarks / Notes" value={customer.notes}
                  onChange={e => setCustomer({...customer, notes: e.target.value})}
                  className="w-full p-3 bg-gray-50 rounded-xl border text-sm min-h-[80px] focus:outline-none focus:border-[#bf4a53]" />
                <div className="bg-blue-50/50 rounded-xl p-4 text-center">
                  <p className="text-xs font-semibold text-blue-700">Photo taken at pickup</p>
                  <p className="text-[10px] text-blue-500 mt-0.5">Pre-rental condition photo will be captured when the customer picks up the item.</p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Receipt */}
          {step === 3 && (
            <div key="step3" className="step-enter overflow-y-auto pr-1 space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-bold text-gray-900">Review Transaction</h3>
                <p className="text-sm text-gray-500">Finalize rental details</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                <div className="bg-[#bf4a53] text-white p-5 text-center">
                  <svg className="w-6 h-6 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="font-bold">{selectedItem?.name}</p>
                </div>
                <div className="p-5 space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Customer</span><span className="font-semibold">{customer.name}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Pickup</span><span className="font-semibold">{new Date(customer.rentalDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Event Date</span><span className="font-semibold">{new Date(customer.eventDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Return By</span><span className="font-semibold">{new Date(customer.returnDate).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}</span></div>
                  <div className="flex justify-between font-bold"><span>{selectedItem?.name}</span><span>₱{totals.baseRate.toLocaleString()}</span></div>
                  {totals.discount > 0 && (
                    <div className="flex justify-between text-emerald-600"><span>Discount ({discountPct}%)</span><span>-₱{totals.discount.toLocaleString()}</span></div>
                  )}
                  {totals.discount > 0 && (
                    <div className="flex justify-between text-sm"><span className="text-gray-500">After Discount</span><span className="font-semibold">₱{totals.discountedRate.toLocaleString()}</span></div>
                  )}
                  {includeDownpayment && totals.downpayment > 0 && (
                    <div className="flex justify-between text-[#bf4a53]"><span>Downpayment</span><span>-₱{totals.downpayment.toLocaleString()}</span></div>
                  )}
                  <div className="flex justify-between font-bold text-base border-t pt-3 mt-2"><span>Balance</span><span className="text-[#bf4a53]">₱{totals.balance.toLocaleString()}</span></div>
                  {discountAuthorized && (
                    <p className="text-[10px] text-emerald-600 font-medium text-center pt-1">Discount authorized by {discountAuthorized.name}</p>
                  )}
                  {customer.notes && <p className="text-xs text-gray-500 italic mt-2">Notes: {customer.notes}</p>}
                </div>
              </div>

              {/* Discount Section */}
              <div className="bg-white rounded-2xl shadow-sm border p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Percent size={16} className="text-gray-500" />
                    <h4 className="font-bold text-sm text-gray-900">Discount</h4>
                  </div>
                  {!discountAuthorized ? (
                    <button onClick={() => setShowAdminAuth(true)}
                      className="text-xs font-bold text-[#bf4a53] hover:underline">
                      + Apply Discount
                    </button>
                  ) : (
                    <button onClick={() => { setDiscountAuthorized(null); setDiscountPct(0); }}
                      className="text-xs font-bold text-red-500 hover:underline">
                      Remove
                    </button>
                  )}
                </div>
                {discountAuthorized && (
                  <div>
                    <div className="flex items-center gap-3">
                      <input type="range" min={0} max={50} value={discountPct}
                        onChange={e => setDiscountPct(Number(e.target.value))}
                        className="flex-1 accent-[#bf4a53]" />
                      <span className="text-sm font-bold text-gray-900 w-12 text-right">{discountPct}%</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-emerald-600 font-medium">
                      <ShieldCheck size={12} />
                      Authorized by {discountAuthorized.name}
                    </div>
                  </div>
                )}
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
          <button onClick={handleBack} className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
            Back
          </button>
          <button
            onClick={handleNext}
            disabled={submitting || (step >= 2 && (availability.checking || availability.available === false))}
            className="flex-[2] py-2.5 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 transition-colors shadow flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
            {step === 3 ? (submitting ? 'Processing…' : 'Confirm & Process') : availability.checking ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </div>
      </div>

      {/* Admin Auth Modal (at top level to avoid transform breaking fixed) */}
      {showAdminAuth && (
        <div className="fixed inset-0 z-[250] bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowAdminAuth(false)}>
          <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
          <div role="dialog" aria-modal="true" aria-labelledby="dialog-title-admin-auth" className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4 pointer-events-auto" onClick={e => e.stopPropagation()}>
            <h4 id="dialog-title-admin-auth" className="font-bold text-gray-900">Admin Authorization</h4>
            <p className="text-xs text-gray-500">Enter admin credentials to apply a discount.</p>
            {authError && <p className="text-xs text-red-500 font-medium bg-red-50 p-3 rounded-xl">{authError}</p>}
            <input type="email" placeholder="Admin Email" value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)}
              className="w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]" />
            <input type="password" placeholder="Password" value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              className="w-full p-3 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]" />
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAdminAuth(false); setAuthError(''); setAdminEmail(''); setAdminPassword(''); }}
                className="flex-1 py-2.5 rounded-full font-bold text-sm border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={async () => {
                setAuthLoading(true); setAuthError('');
                try {
                  const res = await api.post('/auth/verify-admin', { email: adminEmail, password: adminPassword });
                  setDiscountAuthorized(res.admin);
                  setShowAdminAuth(false);
                  setAdminEmail(''); setAdminPassword('');
                } catch (err) {
                  setAuthError(err?.body?.error || err?.message || 'Authorization failed');
                } finally { setAuthLoading(false); }
              }} disabled={authLoading}
                className="flex-[2] py-2.5 rounded-full font-bold text-sm bg-[#bf4a53] text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {authLoading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {authLoading ? 'Verifying...' : 'Authorize'}
              </button>
            </div>
                </div>
              </div>
            {filteredCatalog.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-center px-6">
                <p className="text-sm font-semibold text-gray-700">No available items to rent right now.</p>
                <p className="text-xs text-gray-400 mt-1">All garments are currently booked, in cleaning, or unavailable.</p>
              </div>
            )}
            </div>
          )}
    </div>
  );
}
