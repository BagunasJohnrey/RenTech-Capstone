import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { tabPath, tabFromPath, homeTab, HOME_PATH, SIGN_IN_PATH, GUEST_COLLECTION_PATH, ITEM_DETAIL_RE, TX_DETAIL_RE, itemDetailPath, txDetailPath, pathRequiresRole } from './utils/routing';
import {
  LayoutGrid, ShoppingBag, Clock, Sparkles, Settings, User,
  ClipboardList, AlertTriangle, MessageCircle
} from 'lucide-react';

import { useAuth } from './hooks/useAuth';
import { useInventory } from './hooks/useInventory';
import { useTransactions, normalizeTx } from './hooks/useTransactions';
import { useStaff } from './hooks/useStaff';
import { useCustomerProfile } from './hooks/useCustomerProfile';
import { api, API_ORIGIN } from './utils/api';
import { useToast } from './components/Toast';

import LoginPage from './pages/LoginPage';
import ForgotPasswordView from './pages/ForgotPasswordView';
import VerifyEmailView from './pages/VerifyEmailView';
import OAuthErrorView from './pages/OAuthErrorView';
import PrivacyPolicyView from './pages/PrivacyPolicyView';
import TermsOfServiceView from './pages/TermsOfServiceView';
import GoogleSignupDetails from './components/GoogleSignupDetails';
import ForcedPasswordChange from './components/ForcedPasswordChange';
import InventoryPage from './pages/InventoryPage';
import TasksPage from './pages/TasksPage';
import HelpGuide from './pages/HelpGuide';
import ConfirmModal from './components/ConfirmModal';
import ItemForm from './components/ItemForm';
import AppLayout from './layout/AppLayout';
import NotFoundPage from './pages/NotFoundPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import { SkeletonScreen } from './components/Skeleton';
import { PageSkeleton } from './components/PageSkeletons';
import ProcessReturnModal from './components/ProcessReturnModal';
import ReleaseItemModal from './components/ReleaseItemModal';
import OutOfServiceModal from './components/OutOfServiceModal';
import AvailabilityCalendar from './components/AvailabilityCalendar';
import OnboardingTutorial from './components/OnboardingTutorial';
import GlobalSearchModal from './components/GlobalSearchModal';
import ItemDetailModal from './components/ItemDetailModal';

// Route-level screens are code-split so the heavy recharts bundle (dashboard /
// analytics) is only fetched when those tabs are actually opened.
const DashboardView = lazy(() => import('./pages/DashboardView'));
const AIInsightsView = lazy(() => import('./pages/AIInsightsView'));
const InventoryAnalyticsView = lazy(() => import('./pages/InventoryAnalyticsView'));
const ProfileSettingsView = lazy(() => import('./pages/ProfileSettingsView'));
const StaffNewRental = lazy(() => import('./pages/StaffNewRental'));
const NotificationsView = lazy(() => import('./pages/NotificationsView'));
const MessagesView = lazy(() => import('./pages/MessagesView'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
// Modal/large components that drag heavy deps (framer-motion, qrcode,
// html5-qrcode, react-markdown) into the boot bundle — deferred until opened.
const LandingPage = lazy(() => import('./pages/LandingPage'));
const CustomerRentalFlow = lazy(() => import('./components/CustomerRentalFlow'));
const ChatbotModal = lazy(() => import('./components/ChatbotModal'));
const QrScannerModal = lazy(() => import('./components/QrScannerModal'));
const TransactionDetailModal = lazy(() => import('./components/TransactionDetailModal'));

const navItems = {
  Admin: [
    { id: 'Dashboard', icon: LayoutGrid, label: 'Dashboard' },
    { id: 'Catalog', icon: ShoppingBag, label: 'Inventory' },
    { id: 'History', icon: Clock, label: 'Transactions' },
    { id: 'AI Insights', icon: Sparkles, label: 'Reports', special: true },
    { id: 'Messages', icon: MessageCircle, label: 'Messages' },
    { id: 'Settings', icon: Settings, label: 'Settings' },
  ],
  Staff: [
    { id: 'Dashboard', icon: LayoutGrid, label: 'Dashboard' },
    { id: 'Tasks', icon: ClipboardList, label: 'Tasks' },
    { id: 'Catalog', icon: ShoppingBag, label: 'Catalog' },
    { id: 'History', icon: Clock, label: 'Logs & Returns' },
    { id: 'Settings', icon: Settings, label: 'Settings' },
  ],
  Customer: [
    { id: 'Home', icon: LayoutGrid, label: 'Home' },
    { id: 'Catalog', icon: ShoppingBag, label: 'Collection' },
    { id: 'History', icon: Clock, label: 'Transactions' },
    { id: 'Profile', icon: User, label: 'Profile' },
    { id: 'Help', icon: User, label: 'Help Guide' },
  ],
};

export default function RentechApp() {
  const { isLoggedIn, role, profile, loading, logout, updateProfile, fetchProfile, completeOAuth, cancelOAuth, completeForcedPasswordChange } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  // viewRole mirrors role (was state, but it's always synced to it).
  const viewRole = role;
  // The active tab is derived from the URL; navigating = changing the URL.
  // Detail URLs (/collection/5, /admin/transactions/12, …) resolve to their
  // parent tab for the page underneath, plus a routed modal.
  const itemDetailMatch = location.pathname.match(ITEM_DETAIL_RE);
  const txDetailMatch = location.pathname.match(TX_DETAIL_RE);
  // Strip a trailing detail id (numeric item id OR a transaction UUID) so the
  // underlying tab resolves for detail URLs like /staff/logs/<uuid>.
  const basePath = location.pathname.replace(/\/(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d+)$/, '');
  // '/' is the app entry: customers get their Home, staff/admin get their
  // dashboard (otherwise they'd hit the Unauthorized page right after login).
  const activeTab = (location.pathname === '/' && viewRole)
    ? homeTab(viewRole)
    : tabFromPath(viewRole, basePath);
  // Paths that belong to another role (for the Unauthorized page).
  const roleOwnsPath = pathRequiresRole(location.pathname);
  const [showOAuthDetails, setShowOAuthDetails] = useState(false);

  // Incremented on every nav click (even the same tab) so AppLayout knows to
  // jump the content scroller to the top — the window doesn't scroll in this
  // app shell, only the inner content div does.
  const [navTick, setNavTick] = useState(0);
  const goTab = (tabId) => {
    setNavTick((t) => t + 1);
    navigate(tabPath(viewRole, tabId));
  };
  // One-shot History search prefill (Item Performance row click): consumed +
  // cleared by HistoryView on arrival so later visits start unfiltered.
  const [historySearch, setHistorySearch] = useState('');
  const viewItemTransactions = (item) => {
    if (!item) return;
    setHistorySearch(item.name || '');
    goTab('History');
  };

  const handleOAuthDetails = async (details) => {
    await completeOAuth(details);
    setShowOAuthDetails(false);
    window.history.replaceState({}, document.title, '/');
    navigate('/', { replace: true });
  };

  const cancelOAuthDetails = async () => {
    try { await cancelOAuth(); } catch {}
    setShowOAuthDetails(false);
    window.history.replaceState({}, document.title, '/');
    navigate('/', { replace: true });
  };

  // Phase 3: The backend redirects incomplete Google sign-ups to
  // /oauth-details?email=... The frontend shows the profile-details form.
  useEffect(() => {
    if (location.pathname === '/oauth-details') {
      setShowOAuthDetails(true);
    }
  }, [location.pathname]);

  // Phase 3: Google redirects the browser to /oauth/callback?code=... (the
  // redirect_to the backend gave it). Forward the code to the backend
  // endpoint, which exchanges it (PKCE verifier + code live in httpOnly
  // cookies), mints session cookies, and 302s back to "/" or "/oauth-details".
  useEffect(() => {
    if (location.pathname !== '/oauth/callback') return;
    const params = new URLSearchParams(location.search);
    const oauthError = params.get('error');
    const code = params.get('code');
    if (oauthError) {
      navigate('/', { replace: true });
    } else if (code) {
      window.location.href = `${API_ORIGIN}/api/auth/oauth/callback?code=${encodeURIComponent(code)}`;
    } else {
      navigate('/', { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const {
    inventory,
    setInventory,
    load: loadInventory,
    addItem,
    updateItem,
    setStatus: setItemStatus,
    setBulkStatus,
    loading: inventoryLoading,
  } = useInventory();
  const {
    transactions,
    setTransactions,
    load: loadTransactions,
    create: createTransaction,
    processReturn: processReturnTx,
    cancel: cancelTransaction,
    remove: removeTransaction,
    release: releaseTransaction,
    getById,
    prefetchTx,
    loading: transactionsLoading,
  } = useTransactions();
  // Staff accounts (Admin) — encapsulated in useStaff (SoC).
  const { staffAccounts, staffLoadError, loadStaff, addStaff, removeStaff, updateStaff } = useStaff();
  // Editable customer profile + sync with auth profile — useCustomerProfile (SoC).
  const { customerInfo, syncFromProfile, updateCustomer } = useCustomerProfile(updateProfile);

  // Overdue badge count for Tasks nav
  const overdueCount = useMemo(() => {
    if (!transactions.length) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return transactions.filter(tx =>
      tx.status === 'Overdue' || (tx.status === 'Active' && new Date(tx.dueDate || tx.date) < today)
    ).length;
  }, [transactions]);

  // Modal / page states
  const [showStaffRental, setShowStaffRental] = useState(false);
  const [staffBookingItem, setStaffBookingItem] = useState(null);
  const [returnTransaction, setReturnTransaction] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [customerRental, setCustomerRental] = useState(null);
  const [showChatbot, setShowChatbot] = useState(false);
  // Signed-out screens are URL-driven: /sign-in and /collection (guest) are
  // real routes, so they survive refreshes, new tabs, and back/forward.
  const goSignIn = () => navigate(SIGN_IN_PATH);
  const goGuestCollection = () => navigate(GUEST_COLLECTION_PATH);
  const guestCollection = location.pathname === GUEST_COLLECTION_PATH;
  const [outOfServiceItem, setOutOfServiceItem] = useState(null);

  // Load inventory for guest (public) catalog browsing.
  useEffect(() => {
    if (guestCollection) loadInventory().catch(() => {});
  }, [guestCollection, loadInventory]);

  // Entering/exiting the guest collection swaps the whole page (landing ⇄
  // catalog) via route change, so the window keeps its old scroll
  // position — reset it so the new view starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [guestCollection]);

  // Availability calendar
  const [calendarItem, setCalendarItem] = useState(null);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Staff removal confirmation
  const [staffToRemove, setStaffToRemove] = useState(null);

  // Logout modal state
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Onboarding tutorial
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Global search
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  // Fetch fallback for a routed transaction id missing from the loaded list
  // (deep link / fresh reload). The list hit below resolves synchronously.
  const [fetchedTx, setFetchedTx] = useState(null);

  // Staff QR scanner — the staff member first picks RELEASE or RETURN, then
  // the scanned transaction opens straight into the matching modal.
  const [showScanner, setShowScanner] = useState(false);
  const [scannedTx, setScannedTx] = useState(null);
  const [scannedAction, setScannedAction] = useState(null); // 'release' | 'return'

  // Ctrl+K keyboard shortcut for global search
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (viewRole === 'Staff' || viewRole === 'Admin') {
          setShowGlobalSearch(s => !s);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewRole]);

  // Current path, read via ref so the profile effect below doesn't re-fire on
  // every route change (it used to subscribe to location.pathname, which made
  // it re-run and fight the logout navigate by bouncing staff/admin back to
  // their portal).
  const pathRef = useRef(location.pathname);
  useEffect(() => { pathRef.current = location.pathname; }, [location.pathname]);

  // Set while signing out: the portal bounce below must be suppressed, or the
  // logout navigate to '/' re-fires this effect (useNavigate is recreated on
  // every location change in react-router v7) and bounces staff/admin back to
  // their portal URL right before the profile clears — landing them on 404.
  const loggingOutRef = useRef(false);

  useEffect(() => {
    if (profile) {
      syncFromProfile(profile);
      // After auth restore, staff/admin who landed on the app root (the
      // landing/login URL) get sent to their portal so the URL matches the
      // view. Customers keep '/' as their Home. Other paths are left alone —
      // deep links must not be clobbered and cross-role URLs must reach the
      // Unauthorized page instead of silently bouncing.
      if (pathRef.current === '/' && role && role !== 'Customer' && !loggingOutRef.current) {
        navigate(HOME_PATH[role], { replace: true });
      }
      const onboardingKey = profile.role === 'Customer' ? 'onboardingDone_Customer'
        : profile.role === 'Admin' ? 'onboardingDone_Admin'
        : 'onboardingDone_Staff';
      if (!localStorage.getItem(onboardingKey)) {
        setShowOnboarding(true);
      }
    }
  }, [profile, syncFromProfile, role, navigate]);

  useEffect(() => {
    if (!isLoggedIn) return;
    loadInventory().catch(() => {});
    loadTransactions().catch(() => {});
    if (role === 'Admin') {
      loadStaff().catch(() => {});
    }
    // Preload the transaction detail chunk while idle so the first popup
    // open never pays the lazy-chunk download on top of mount + data.
    const preload = () => import('./components/TransactionDetailModal').catch(() => {});
    if (typeof requestIdleCallback === 'function') requestIdleCallback(preload);
    else setTimeout(preload, 2000);
  }, [isLoggedIn, role, loadInventory, loadTransactions, loadStaff]);

  // Routed detail modals: resolve the URL id into a full record. Rendering is
  // gated on the route match, so stale state when the URL changes is harmless.
  // Item — from the inventory list when loaded, else fetch the single record.
  useEffect(() => {
    if (!isLoggedIn || !itemDetailMatch) return;
    const id = Number(itemDetailMatch[1]);
    const found = inventory.find((i) => i.id === id);
    if (found) { setDetailItem(found); return; }
    api.get(`/inventory/${id}`).then(setDetailItem).catch(() => {});
  }, [isLoggedIn, itemDetailMatch, inventory]);

  // Transaction — from the list when loaded, else fetch the full record.
  // Transaction ids are UUID strings (NOT numbers) — keep them as strings.
  // NOTE: depend on the extracted id string only — `txDetailMatch` is a new
  // RegExp match object on every render, which would retrigger this effect in
  // an infinite loop (React "Maximum update depth exceeded").
  const txDetailId = txDetailMatch ? String(txDetailMatch[1]) : null;
  useEffect(() => { setFetchedTx(null); }, [txDetailId]);
  useEffect(() => {
    if (!isLoggedIn || !txDetailId) return;
    // List covers it — the memo below resolves it synchronously, no fetch.
    if (transactions.some((t) => String(t.id) === txDetailId)) return;
    let cancelled = false;
    getById(txDetailId)
      .then((full) => { if (!cancelled) setFetchedTx(normalizeTx(full)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isLoggedIn, txDetailId, transactions, getById]);
  // Resolve during render (not in an effect) so the modal mounts with its
  // record on the same frame as the navigation — previously the effect's
  // setState cost a full extra render cycle before anything appeared.
  const routedTx = useMemo(() => {
    if (!txDetailId) return null;
    const found = transactions.find((t) => String(t.id) === txDetailId);
    return found ? normalizeTx(found) : fetchedTx;
  }, [txDetailId, transactions, fetchedTx]);

  // Mobile system back button: keep navigation inside the app instead of
  // leaving it. A guard history entry is pushed while logged in; each back
  // press with an open overlay closes the topmost one (re-arming the guard).
  // Plain tab switches push real URLs already, so with nothing open the
  // browser navigates normally. Routed detail modals are URL-driven too, so
  // they need no handling here.
  const overlayCloserRef = useRef(() => false);
  useEffect(() => {
    overlayCloserRef.current = () => {
      if (deleteConfirm) { setDeleteConfirm(null); return true; }
      if (staffToRemove) { setStaffToRemove(null); return true; }
      if (showLogoutModal) { setShowLogoutModal(false); return true; }
      if (showOnboarding) { setShowOnboarding(false); return true; }
      if (returnTransaction) { setReturnTransaction(null); return true; }
      if (editingItem) { setEditingItem(null); return true; }
      if (showAddItemModal) { setShowAddItemModal(false); return true; }
      if (outOfServiceItem) { setOutOfServiceItem(null); return true; }
      if (scannedTx) { setScannedTx(null); setScannedAction(null); return true; }
      if (customerRental) { setCustomerRental(null); return true; }
      if (showStaffRental || staffBookingItem) {
        // StaffNewRental runs its own discard-confirm guard for dirty forms.
        window.dispatchEvent(new Event('rentech:request-close'));
        return true;
      }
      if (showChatbot) { setShowChatbot(false); return true; }
      if (calendarItem) { setCalendarItem(null); return true; }
      if (showGlobalSearch) { setShowGlobalSearch(false); return true; }
      if (showScanner) { setShowScanner(false); return true; }
      if (showNotifications) { setShowNotifications(false); return true; }
      return false;
    };
  });
  useEffect(() => {
    if (!isLoggedIn) return;
    const arm = () => { try { window.history.pushState({ rentechGuard: true }, ''); } catch { /* ignore */ } };
    arm();
    const onPopState = () => {
      const closer = overlayCloserRef.current;
      if (closer && closer()) arm();
      // else: nothing open — let the browser navigate (tabs are URL-driven).
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isLoggedIn]);

  const handleLogout = async () => {
    // Leave the portal URL first — otherwise the signed-out render (which
    // 404s any path other than '/') would show "Page not found" after logout.
    loggingOutRef.current = true;
    navigate('/', { replace: true });
    setShowLogoutModal(false);
    await logout();
    loggingOutRef.current = false;
  };

  // ---- Transaction mutations delegate to useTransactions (SoC) ----
  const markItemStatus = (itemId, status) =>
    setInventory((prev) => prev.map((i) => (i.id === itemId ? { ...i, status } : i)));

  // Staff rental handler (with walk-in customer 404 fallback).
  // Returns the created tx on success; re-throws on failure so the child
  // (StaffNewRental) can show its own error banner instead of a false success toast.
  const handleStaffNewRental = async (data) => {
    const payload = {
      customerName: data.customer,
      itemId: data.itemId,
      rentalDate: data.rentalDate,
      dueDate: data.returnDate || data.dueDate,
      rentalFee: data.amount || data.rentalFee,
      downpayment: data.downpayment || 0,
      notes: data.notes || '',
      conditionPhoto: data.conditionPhoto || undefined,
      size: data.size || undefined,
      measurements: data.measurements || undefined,
    };
    const doCreate = async () => {
      const created = await createTransaction(payload);
      if (created.itemId) markItemStatus(created.itemId, 'Rented');
      return created;
    };
    // SECURITY (L2): the backend already auto-creates *synthetic* walk-in
    // profiles (no auth account → can't log in) when customerName has no
    // profile. We deliberately removed the old 404 fallback that created real
    // Supabase auth accounts with a known password.
    const created = await doCreate(); // throws naturally on failure → UI shows the error
    toastSuccess('Rental created successfully');
    return created;
  };

  // Roll back a customer booking that was committed before payment confirmation.
  // Cancels the transaction server-side and reverts the item to Available locally.
  const handleCancelBooking = async (created) => {
    try {
      await cancelTransaction(created.id);
    } catch {
      // best-effort: still clean up local state below
    }
    setTransactions((prev) => prev.filter((t) => t.id !== created.id));
    if (created.itemId) markItemStatus(created.itemId, 'Available');
  };

  // Process return (FIX D: surface errors). A damaged return takes the item
  // OUT of rotation (skips cleaning); an intact return goes to Cleaning.
  const handleProcessReturn = async (txId, isDamaged, isLate, returnPhoto, damageReason) => {
    try {
      const updated = await processReturnTx(txId, {
        returnDate: new Date().toISOString().split('T')[0],
        isDamaged: !!isDamaged,
        returnPhoto: returnPhoto || undefined,
        damageReason: damageReason || undefined,
      });
      if (updated.itemId) {
        markItemStatus(updated.itemId, isDamaged ? 'OutOfService' : 'Cleaning');
      }
      toastSuccess(isDamaged ? 'Return processed — item taken out of rotation' : 'Return processed — item moved to cleaning');
    } catch (err) {
      toastError(err?.message || 'Failed to process return');
    }
    setReturnTransaction(null);
  };

  // Delete transaction (FIX D: surface errors)
  const handleDeleteTransaction = async (txId) => {
    try {
      await removeTransaction(txId);
      toastSuccess('Transaction deleted');
    } catch (err) {
      toastError(err?.message || 'Failed to delete transaction');
    }
  };

  // Cancel transaction (FIX D: surface errors) — syncs local state so the
  // list + item card update immediately (frees the item to Available).
  const handleCancelTransaction = async (txId) => {
    try {
      await cancelTransaction(txId);
      const tx = transactions.find((t) => t.id === txId);
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, status: 'Cancelled' } : t)));
      if (tx?.itemId) markItemStatus(tx.itemId, 'Available');
      toastSuccess('Transaction cancelled');
    } catch (err) {
      toastError(err?.message || 'Failed to cancel transaction');
    }
  };

  const handleReleaseRental = async (updated) => {
    releaseTransaction(updated);
    if (updated.itemId) markItemStatus(updated.itemId, 'Rented');
    toastSuccess('Item released');
  };

  // Customer booking handler
  const handleCustomerBooking = async (bookingData) => {
    const created = await api.post('/bookings', {
      itemId: bookingData.itemId,
      rentalDate: bookingData.rentalDate || bookingData.date,
      dueDate: bookingData.dueDate || bookingData.returnDate,
      // rentalFee intentionally omitted — the server derives it from the item.
      downpayment: bookingData.downpayment || 0,
      notes: bookingData.notes || '',
    });
    setTransactions((prev) => [normalizeTx(created), ...prev]);
    if (created.itemId) {
      // FIX C: match the backend's authoritative status (Active) instead of 'Reserved'.
      markItemStatus(created.itemId, 'Active');
    }
    toastSuccess('Booking confirmed');
    setCustomerRental(null);
    goTab('History');
  };

  // Booking submission from the rental flow — returns the created tx
  // (no navigation; the flow controls its own closing). FIX B: forwards
  // promoCode/size/measurements so the discount is persisted server-side.
  const handleSubmitBooking = async (bookingData) => {
    const created = await api.post('/bookings', {
      itemId: bookingData.itemId,
      rentalDate: bookingData.rentalDate || bookingData.date,
      dueDate: bookingData.dueDate || bookingData.returnDate,
      // rentalFee intentionally omitted — the server derives it sale-aware.
      downpayment: bookingData.downpayment || 0,
      notes: bookingData.notes || '',
      promoCode: bookingData.promoCode || undefined,
      size: bookingData.size || undefined,
      measurements: bookingData.measurements || undefined,
    });
    setTransactions((prev) => [normalizeTx(created), ...prev]);
    if (created.itemId) markItemStatus(created.itemId, 'Active'); // FIX C
    return created;
  };

  const handleAddStaff = async (newStaff) => {
    const created = await addStaff(newStaff);
    toastSuccess('Staff account created — share the one-time password');
    return created;
  };
  const handleRemoveStaff = (staff) => {
    setStaffToRemove(staff);
  };

  // Inventory mutations are delegated to useInventory and surface failures
  // to the user (FIX: previously swallowed via console.error).
  const handleQuickStatusChange = async (itemId, status, outOfServiceReason) => {
    try {
      await setItemStatus(itemId, status, outOfServiceReason);
      toastSuccess(status === 'OutOfService' ? 'Item marked as out of service' : `Item marked as ${status}`);
    } catch (err) {
      toastError(err?.message || 'Failed to update item status');
    }
  };

  // Mark a returned item (currently 'Cleaning') as clean/available again.
  const markItemClean = async (itemId) => {
    await setItemStatus(itemId, 'Available');
  };

  // Batch "mark cleaned": every selected item in the Cleaning queue becomes
  // Available at once (the boutique cleans in batches).
  const handleBulkClean = async (ids) => {
    await setBulkStatus(ids, 'Available');
  };

  // "Mark Out of Service" opens a reason modal; the chosen reason is stored
  // on the item (and shown in the catalog/dashboard).
  const handleOutOfServiceConfirm = async (item, reason) => {
    try {
      await setItemStatus(item.id, 'OutOfService', reason);
      toastSuccess('Item taken out of service');
      setOutOfServiceItem(null);
    } catch (err) {
      toastError(err?.message || 'Failed to update item status');
    }
  };

  const handleAddItem = async (values) => {
    // Non-admins must never send sale fields (backend 403s otherwise).
    const clean = { ...values };
    if (role !== 'Admin') {
      delete clean.onSale;
      delete clean.discountPct;
      delete clean.salePrice;
      delete clean.saleEndsAt;
    }
    try {
      await addItem(clean);
      toastSuccess('Inventory item added');
    } catch (err) {
      toastError(err?.message || 'Failed to add item');
    }
  };

  const handleUpdateItem = async (values) => {
    try {
      const clean = { ...editingItem, ...values };
      if (role !== 'Admin') {
        delete clean.onSale;
        delete clean.discountPct;
        delete clean.salePrice;
        delete clean.saleEndsAt;
      }
      await updateItem(clean);
      toastSuccess('Inventory item updated');
    } catch (err) {
      toastError(err?.message || 'Failed to update item');
    }
  };

  const handleDeleteInventoryItem = (itemId) => handleQuickStatusChange(itemId, 'Deleted');

  const handleRestoreInventoryItem = (itemId) => handleQuickStatusChange(itemId, 'Available');

  const handleReturnClick = (tx) => {
    const item = inventory.find(i => i.id === tx.itemId);
    if (item && item.status !== 'Rented') {
      alert(`"${item.name}" has not been released yet. Release the item first before processing a return.`);
      return;
    }
    setReturnTransaction(tx);
  };

  const currentNav = navItems[viewRole || 'Admin'];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fcfcfd] flex items-center justify-center px-5 md:px-10">
        <div className="w-full max-w-7xl">
          <PageSkeleton tab={activeTab} />
        </div>
      </div>
    );
  }

  // First-login staff gate: a freshly created staff account (one-time
  // password) locks the whole app to the change-password screen. Must come
  // before every other authed branch so a mustChangePassword session can't
  // reach the dashboard (the backend also 403s non-auth endpoints).
  if (isLoggedIn && profile?.mustChangePassword) {
    return (
      <ForcedPasswordChange
        email={profile.email}
        onComplete={async (args) => {
          await completeForcedPasswordChange(args);
          toastSuccess('Password set — welcome!');
        }}
        onLogout={logout}
      />
    );
  }

  // Phase 3: OAuth details form (shown after incomplete Google sign-up via
  // the server-side redirect → /oauth-details route).
  if (!isLoggedIn && showOAuthDetails) {
    const email = new URLSearchParams(window.location.search).get('email') || '';
    return (
      <GoogleSignupDetails
        email={email}
        onComplete={handleOAuthDetails}
        onCancel={cancelOAuthDetails}
      />
    );
  }

  // Google OAuth sign-up: collect missing details before completing the account.

  // Public privacy policy (/privacy) — must be reachable signed-out (Google
  // OAuth branding verification + landing footer link directly here).
  if (location.pathname === '/privacy') {
    return <PrivacyPolicyView />;
  }

  // Public terms of service (/terms) — standalone signed-out page reusing the
  // same TERMS_SECTIONS text as the signup modal and Help Guide.
  if (location.pathname === '/terms') {
    return <TermsOfServiceView />;
  }

  // Signed-in users never need the sign-in page — send them to their home.
  if (isLoggedIn && location.pathname === SIGN_IN_PATH) {
    return <Navigate to={HOME_PATH[viewRole] ?? '/'} replace />;
  }

  // Fallback + role guard: unknown URL -> 404 page; URL owned by another role
  // -> Unauthorized page (no silent redirect). Runs after the auth gates so
  // role is resolved.
  if (isLoggedIn && activeTab == null) {
    // OAuth round-trip pads: /oauth/callback and /oauth-details are transient
    // landing spots while the code is exchanged or the details form is shown —
    // never "not found". With a still-valid session, isLoggedIn is already
    // true for a frame here; show a skeleton instead of flashing the 404.
    if (location.pathname === '/oauth/callback' || location.pathname === '/oauth-details') {
      return (
        <div className="min-h-screen bg-[#fcfcfd] flex items-center justify-center">
          <SkeletonScreen />
        </div>
      );
    }
    if (roleOwnsPath && roleOwnsPath !== viewRole) {
      return (
        <UnauthorizedPage onHome={() => navigate(HOME_PATH[viewRole], { replace: true })} />
      );
    }
    return <NotFoundPage signedIn onGoHome={() => navigate(HOME_PATH[viewRole], { replace: true })} />;
  }

  // From the landing Featured Pieces: jump into the guest collection and open
  // that exact item's detail modal (fetching it if inventory isn't loaded yet).
  const handleViewFeatured = async (entry) => {
    const raw = entry?._item;
    const id = raw?.id ?? entry?.id;
    navigate(GUEST_COLLECTION_PATH);

    let item = raw || inventory.find((i) => i.id === id);
    if (!item && id != null) {
      try { item = await api.get(`/inventory/${id}`); } catch { item = null; }
    }
    if (item) setDetailItem(item);
  };

  // Phase 2: Password reset flows (public auth pages, accessible signed-out).
  // The forgot-password form is an inline step inside <Login />; only the reset
  // step needs its own landing page because the email/action link points here
  // with a token_hash.
  if (location.pathname === '/reset-password') {
    return <ForgotPasswordView />;
  }

  // Email verification landing — the signup confirmation link points here with
  // a token_hash. Public: the user is not logged in yet (unconfirmed account).
  if (location.pathname === '/verify-email') {
    return <VerifyEmailView />;
  }

  // OAuth error landing — the backend redirects failed Google sign-ins here
  // (e.g. the email already belongs to an email/password account). Public.
  if (location.pathname === '/oauth-error') {
    return <OAuthErrorView />;
  }

  // Render: Landing -> Login -> Main App (signed-out screens are routes).
  if (!isLoggedIn) {
    if (location.pathname === SIGN_IN_PATH) {
       return <LoginPage />;
    }
    // OAuth round-trip pads while signed out: the SPA lands on /oauth/callback
    // (code exchange in flight) or /oauth-details (details form) before the
    // backend round-trips it home — never flash the guest 404 for these.
    if (location.pathname === '/oauth/callback' || location.pathname === '/oauth-details') {
      return (
        <div className="min-h-screen bg-[#fcfcfd] flex items-center justify-center">
          <SkeletonScreen />
        </div>
      );
    }
    // Unknown URL while signed out -> 404 with a way back to the landing page.
    // /sign-in and /collection are the only public routes besides '/'.
    if (!guestCollection && location.pathname !== '/' && location.pathname !== SIGN_IN_PATH) {
      return <NotFoundPage onGoHome={() => navigate('/', { replace: true })} />;
    }
    // Guest (public) catalog browsing — no account required to look.
    if (guestCollection) {
      return (
        <div className="min-h-screen bg-[#FAFAFB] selection:bg-[#bf4a53]/10 selection:text-[#bf4a53] overflow-x-hidden">
          {/* Glass nav — matches landing page */}
          <header className="fixed top-0 inset-x-0 z-40 bg-[#FAFAFB]/80 backdrop-blur-lg border-b border-gray-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 md:py-4 flex items-center justify-between gap-3">
              <button onClick={() => navigate('/', { replace: true })} className="flex items-center gap-2 font-extrabold tracking-tighter text-gray-950 shrink-0">
                <img src="/RenTech.png" alt="RENTECH" className="w-8 h-8 md:w-9 md:h-9 object-contain rounded-xl" />
                <span className="hidden sm:block">RENTECH<span className="text-[#bf4a53]">.</span></span>
              </button>

              <div className="flex items-center gap-2 md:gap-3 shrink-0">
                <button
                  onClick={goSignIn}
                  className="bg-[#bf4a53] text-white px-5 py-2.5 md:px-7 md:py-3 rounded-full font-bold text-xs md:text-sm shadow-lg shadow-[#bf4a53]/20 hover:bg-[#a63f47] transition-colors whitespace-nowrap"
                >
                  Sign In to Rent
                </button>
              </div>
            </div>
          </header>

          {/* Hero label */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-28 md:pt-32 pb-2 md:pb-4 text-center relative">
            <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:32px_32px] opacity-40 -z-10" />
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tighter text-gray-950">
              The Collection
            </h1>
            <p className="mt-3 text-sm md:text-base text-gray-500 font-medium max-w-xl mx-auto">
              Browse as a guest. Sign in to book instantly, or tap any piece to see details and availability.
            </p>
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8">
            <InventoryPage
              role="Customer"
              inventory={inventory}
              loading={inventoryLoading}
              guest
              onViewDetail={(item) => setDetailItem(item)}
              onGuestBook={goSignIn}
              onExitGuest={() => navigate('/', { replace: true })}
            />
            {detailItem && (
              <ItemDetailModal
                item={detailItem}
                guest
                onClose={() => setDetailItem(null)}
                onGuestBook={() => { setDetailItem(null); goSignIn(); }}
              />
            )}
          </div>
        </div>
      );
    }
    return (
      <Suspense fallback={<SkeletonScreen />}>
        <LandingPage
          onLogin={goSignIn}
          onBrowse={goGuestCollection}
          onViewFeatured={handleViewFeatured}
        />
      </Suspense>
    );
  }

  const taskBadge = viewRole === 'Staff' ? overdueCount : 0;

  const page = (
    <>
            {(activeTab === 'Dashboard' || activeTab === 'Home') && (
              <DashboardView
                role={viewRole}
                transactions={transactions}
                inventory={inventory}
                customerInfo={customerInfo}
                onOpenNewRental={() => setShowStaffRental(true)}
                onNavigate={goTab}
                onOpenChatbot={() => setShowChatbot(true)}
                onOpenScanner={() => setShowScanner(true)}
                onCustomerBook={(item) => setCustomerRental({ item, date: new Date().toISOString().split('T')[0] })}
              />
            )}
            {activeTab === 'Tasks' && (
              <TasksPage
                transactions={transactions}
                inventory={inventory}
                onReturn={handleReturnClick}
                onNavigate={goTab}
                onRelease={handleReleaseRental}
                onMarkClean={markItemClean}
                onBulkClean={handleBulkClean}
              />
            )}
            {activeTab === 'Catalog' && (
              <InventoryPage
                role={viewRole}
                inventory={inventory}
                transactions={transactions}
                loading={inventoryLoading}
                onBook={(item, date) => setCustomerRental({ item, date })}
                onCustomerBook={(item) => setCustomerRental({ item, date: new Date().toISOString().split('T')[0] })}
                onViewDetail={(item) => navigate(itemDetailPath(viewRole, item.id))}
                onEdit={setEditingItem}
                onDelete={handleDeleteInventoryItem}
                onRestore={handleRestoreInventoryItem}
                onStatusChange={handleQuickStatusChange}
                onMarkOutOfService={(item) => setOutOfServiceItem(item)}
                onConfirmBooking={handleCustomerBooking}
                onStaffBookItem={(item) => setStaffBookingItem(item)}
                onCheckAvailability={(item) => setCalendarItem(item)}
                onRequestDelete={(item) => setDeleteConfirm(item)}
              />
            )}
            {activeTab === 'History' && (
              <HistoryPage role={viewRole} transactions={transactions} inventory={inventory} loading={transactionsLoading} onReturn={handleReturnClick} onDelete={handleDeleteTransaction} onCancel={handleCancelTransaction} onRelease={handleReleaseRental} fetchFull={getById} prefetchTx={prefetchTx} onNavigateDetail={(tx) => navigate(txDetailPath(viewRole, tx.id))} initialSearch={historySearch} onConsumeSearch={() => setHistorySearch('')} />
            )}
            {activeTab === 'AI Insights' && (
              <AIInsightsView analyticsData={viewRole === 'Admin' ? <InventoryAnalyticsView noHeader /> : null} role={viewRole} onViewItemTransactions={viewItemTransactions} onNavigateTab={goTab} cleaningItems={inventory.filter((i) => i.status === 'Cleaning')} onBulkClean={handleBulkClean} />
            )}
            {(activeTab === 'Profile' || activeTab === 'Settings') && (
              <ProfileSettingsView
                role={viewRole}
                profile={profile}
                staffList={staffAccounts}
                onAddStaff={handleAddStaff}
                onRemoveStaff={handleRemoveStaff}
                onUpdateStaff={updateStaff}
                staffLoadError={staffLoadError}
                customerInfo={customerInfo}
                onUpdateCustomer={updateCustomer}
                onProfileUpdated={fetchProfile}
                onRequestLogout={() => setShowLogoutModal(true)}
              />
            )}
            {activeTab === 'Help' && (
              <HelpGuide role={viewRole} onStartTutorial={() => setShowOnboarding(true)} />
            )}
            {activeTab === 'Notifications' && (
              <NotificationsView role={viewRole} onNavigateTab={goTab} />
            )}
            {activeTab === 'Messages' && (
              <MessagesView onOpenBooking={(txId) => navigate(txDetailPath(viewRole, txId))} />
            )}
    </>
  );

  const overlays = (
    <>
        {returnTransaction && (
          <ProcessReturnModal transaction={returnTransaction} onClose={() => setReturnTransaction(null)} onComplete={handleProcessReturn} />
        )}
        {editingItem && (
          <ItemForm
            title="Edit Inventory Item"
            subtitle={`ID: ${editingItem.id}`}
            initial={editingItem}
            statusOptions={(() => {
              const manual = ['Available', 'Cleaning', 'OutOfService'];
              return manual.includes(editingItem.status) ? manual : [...manual, editingItem.status];
            })()}
            submitLabel="Save Changes"
            showCategory
            showPhoto
            showOccasions
            showSale={role === 'Admin'}
            onSubmit={(values) => handleUpdateItem(values)}
            onClose={() => setEditingItem(null)}
          />
        )}
        {showAddItemModal && (
          <ItemForm
            title="Add New Item"
            statusOptions={['Available', 'Cleaning', 'OutOfService']}
            submitLabel="Add Item"
            showCategory
            showOccasions
            showPhoto
            showSale={role === 'Admin'}
            maxWidth="max-w-lg"
            onSubmit={handleAddItem}
            onClose={() => setShowAddItemModal(false)}
          />
        )}

        {outOfServiceItem && (
          <OutOfServiceModal item={outOfServiceItem} onClose={() => setOutOfServiceItem(null)} onConfirm={handleOutOfServiceConfirm} />
        )}

        {(showStaffRental || staffBookingItem) && (
          <StaffNewRental
            inventory={inventory}
            transactions={transactions}
            onAddTransaction={handleStaffNewRental}
            onClose={() => { setShowStaffRental(false); setStaffBookingItem(null); }}
            initialItem={staffBookingItem}
          />
        )}

        {customerRental && (
        <Suspense fallback={null}>
          <CustomerRentalFlow
            item={customerRental.item}
            selectedDate={customerRental.date}
            inventory={inventory}
            customerInfo={customerInfo}
            onClose={() => setCustomerRental(null)}
            onSubmitBooking={handleSubmitBooking}
            onCancelBooking={handleCancelBooking}
          />
        </Suspense>
        )}

        {showChatbot && (
          <Suspense fallback={null}>
            <ChatbotModal
              onClose={() => setShowChatbot(false)}
              inventory={inventory}
              onBook={(item) => setCustomerRental({ item })}
            />
          </Suspense>
        )}

        {calendarItem && (
          <AvailabilityCalendar item={calendarItem} onClose={() => setCalendarItem(null)} />
        )}

        {deleteConfirm && (
          <ConfirmModal
            title="Delete Item"
            subtitle="This action can be undone."
            message={<>Are you sure you want to delete <span className="font-semibold">{deleteConfirm.name}</span>?</>}
            confirmLabel="Delete"
            variant="danger"
            icon={<AlertTriangle size={20} />}
            zIndex="z-[9999]"
            onConfirm={() => { handleDeleteInventoryItem(deleteConfirm.id); setDeleteConfirm(null); }}
            onCancel={() => setDeleteConfirm(null)}
          />
        )}

        {staffToRemove && (
          <ConfirmModal
            title="Remove Staff Account"
            subtitle={staffToRemove.name || staffToRemove.email}
            message={`This will permanently delete ${staffToRemove.email}'s staff account and all associated data. This action cannot be undone.`}
            confirmLabel="Remove"
            cancelLabel="Cancel"
            variant="danger"
            icon={<AlertTriangle size={20} />}
            zIndex="z-[9999]"
            onConfirm={async () => {
              try {
                await removeStaff(staffToRemove.id);
                toastSuccess('Staff account removed');
              } catch (err) {
                toastError(err?.message || 'Failed to remove staff');
              } finally {
                setStaffToRemove(null);
              }
            }}
            onCancel={() => setStaffToRemove(null)}
          />
        )}

        {showOnboarding && <OnboardingTutorial role={viewRole} onComplete={() => setShowOnboarding(false)} />}

        {/* Routed item detail (logged-in) — URL like /collection/5 or
            /admin/inventory/5; closing navigates back to the parent tab. */}
        {isLoggedIn && itemDetailMatch && detailItem && (
          <ItemDetailModal
            item={detailItem}
            guest={false}
            onClose={() => navigate(basePath, { replace: true })}
            onBook={() => {
              const it = detailItem;
              navigate(basePath, { replace: true });
              setCustomerRental({ item: it, date: new Date().toISOString().split('T')[0] });
            }}
          />
        )}

        {/* Routed transaction detail — URL like /transactions/12,
            /admin/transactions/12 or /staff/logs/12. */}
        {isLoggedIn && txDetailMatch && routedTx && (
          <Suspense fallback={null}>
            <TransactionDetailModal
              transaction={routedTx}
              fetchFull={getById}
              role={role}
              onClose={() => navigate(basePath, { replace: true })}
              onReturn={handleReturnClick}
            />
          </Suspense>
        )}

        {/* Global Search Modal */}
        {showGlobalSearch && (
          <GlobalSearchModal
            transactions={transactions}
            inventory={inventory}
            onClose={() => setShowGlobalSearch(false)}
        onNavigate={(tab) => { goTab(tab); setShowGlobalSearch(false); }}
      />
        )}

        {/* QR Scanner – staff picks RELEASE/RETURN, then scans the booking QR */}
        {showScanner && viewRole === 'Staff' && (
          <Suspense fallback={null}>
            <QrScannerModal
              onClose={() => setShowScanner(false)}
              onFound={(tx, action) => {
                setShowScanner(false);
                setScannedAction(action);
                setScannedTx(normalizeTx(tx));
              }}
            />
          </Suspense>
        )}

        {/* Scanned booking → the release (pickup) modal */}
        {scannedTx && scannedAction === 'release' && (
          <ReleaseItemModal
            transaction={scannedTx}
            onClose={() => { setScannedTx(null); setScannedAction(null); }}
            onReleased={(updated) => { handleReleaseRental(updated); setScannedTx(null); setScannedAction(null); }}
          />
        )}

        {/* Scanned booking → the return modal */}
        {scannedTx && scannedAction === 'return' && (
          <ProcessReturnModal
            transaction={scannedTx}
            onClose={() => { setScannedTx(null); setScannedAction(null); }}
            onComplete={handleProcessReturn}
          />
        )}

        {/* Global Logout Confirmation Modal */}
        {showLogoutModal && (
          <ConfirmModal
            title="Confirm Sign Out"
            message="Are you sure you want to sign out? You will be returned to the landing page."
            confirmLabel="Sign Out"
            variant="primary"
            showClose
            onConfirm={handleLogout}
            onCancel={() => setShowLogoutModal(false)}
          />
        )}
    </>
  );

  return (
    <AppLayout
      viewRole={viewRole}
      activeTab={activeTab}
      setActiveTab={goTab}
      navItems={currentNav}
      onRequestLogout={() => setShowLogoutModal(true)}
      customerInfo={customerInfo}
      role={role}
      onOpenGlobalSearch={() => setShowGlobalSearch(true)}
      onAddItem={() => setShowAddItemModal(true)}
      onOpenSettings={() => goTab('Settings')}
      onOpenHelp={() => goTab('Help')}
      showNotifications={showNotifications}
      onToggleNotifications={() => setShowNotifications((s) => !s)}
      onViewAllNotifications={() => {
        setShowNotifications(false);
        goTab('Notifications');
      }}
      taskBadge={taskBadge}
      scrollKey={`${location.pathname}#${navTick}`}
      animateKey={`${activeTab}#${navTick}`}
      overlays={overlays}
      onFabClick={() => {
        if (viewRole === 'Admin') goTab('AI Insights');
        else if (viewRole === 'Staff') setShowStaffRental(true);
        else setCustomerRental({ item: null, date: new Date().toISOString().split('T')[0] });
      }}
    >
      <Suspense fallback={<PageSkeleton tab={activeTab} />}>
        {page}
      </Suspense>
    </AppLayout>
  );
}