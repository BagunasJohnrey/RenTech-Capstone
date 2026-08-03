import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  LayoutGrid, ShoppingBag, Clock, Sparkles, Settings, User,
  ClipboardList, AlertTriangle
} from 'lucide-react';

import { useAuth } from './hooks/useAuth';
import { useInventory } from './hooks/useInventory';
import { useTransactions, normalizeTx } from './hooks/useTransactions';
import { useStaff } from './hooks/useStaff';
import { useCustomerProfile } from './hooks/useCustomerProfile';
import { api } from './utils/api';
import { useToast } from './components/Toast';

import LoginPage from './pages/LoginPage';
import GoogleSignupDetails from './components/GoogleSignupDetails';
import LandingPage from './pages/LandingPage';
import InventoryPage from './pages/InventoryPage';
import HistoryPage from './pages/HistoryPage';
import TasksPage from './pages/TasksPage';
import HelpGuide from './pages/HelpGuide';
import ConfirmModal from './components/ConfirmModal';
import ItemForm from './components/ItemForm';
import AppLayout from './layout/AppLayout';
import CustomerRentalFlow from './components/CustomerRentalFlow';
import { SkeletonScreen } from './components/Skeleton';
import { PageSkeleton } from './components/PageSkeletons';
import ProcessReturnModal from './components/ProcessReturnModal';
import ChatbotModal from './components/ChatbotModal';
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

const navItems = {
  Admin: [
    { id: 'Dashboard', icon: LayoutGrid, label: 'Dashboard' },
    { id: 'Catalog', icon: ShoppingBag, label: 'Inventory' },
    { id: 'History', icon: Clock, label: 'Transactions' },
    { id: 'AI Insights', icon: Sparkles, label: 'AI Intelligence', special: true },
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
  const { isLoggedIn, role, profile, loading, logout, updateProfile, completeOAuth } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const [oauthProcessing, setOauthProcessing] = useState(
    () => new URLSearchParams(window.location.search).has('code') || window.location.hash.includes('access_token')
  );
  const [oauthDetails, setOauthDetails] = useState(null);
  const oauthHandledRef = useRef(false);

  const handleOAuthDetails = async (details) => {
    await completeOAuth(details);
    setOauthDetails(null);
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  const cancelOAuthDetails = () => {
    setOauthDetails(null);
    setOauthProcessing(false);
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  // Handle Supabase OAuth (Google) redirect: the provider bounces the user
  // back to this SPA with ?code=... (or #access_token=...). Finish the
  // handshake, then clean the URL so it isn't reprocessed on refresh.
  useEffect(() => {
    if (oauthHandledRef.current) return;
    oauthHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const hasCode = params.has('code') || window.location.hash.includes('access_token');
    if (!hasCode) return;
    // NOTE: always clear oauthProcessing + clean the URL in .finally. We must
    // NOT skip this on StrictMode's immediate cleanup (it would leave the
    // loading skeleton stuck). The ref guard above already prevents duplicate
    // handshakes, so there's no double-processing to worry about.
    completeOAuth()
      .then((res) => {
        if (res && res.needsDetails) {
          setOauthDetails({ email: res.email });
        }
      })
      .catch((err) => {
        toastError(err?.body?.error || err?.message || 'Google sign-in failed');
      })
      .finally(() => {
        window.history.replaceState({}, document.title, window.location.pathname);
        setOauthProcessing(false);
      });
  }, [completeOAuth]);

  const [activeTab, setActiveTab] = useState('Dashboard');
  const {
    inventory,
    setInventory,
    load: loadInventory,
    addItem,
    updateItem,
    setStatus: setItemStatus,
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
    loading: transactionsLoading,
  } = useTransactions();
  // Staff accounts (Admin) — encapsulated in useStaff (SoC).
  const { staffAccounts, loadStaff, addStaff, removeStaff } = useStaff();
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
  const [showLoginPage, setShowLoginPage] = useState(false);
  const [guestView, setGuestView] = useState(false);

  // Load inventory for guest (public) catalog browsing.
  useEffect(() => {
    if (guestView) loadInventory().catch(() => {});
  }, [guestView, loadInventory]);

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

  const [viewRole, setViewRole] = useState(role);

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

  useEffect(() => {
    if (profile) {
      syncFromProfile(profile);
      setActiveTab(profile.role === 'Customer' ? 'Home' : 'Dashboard');
      const onboardingKey = profile.role === 'Customer' ? 'onboardingDone_Customer' : 'onboardingDone';
      if (!localStorage.getItem(onboardingKey)) {
        setShowOnboarding(true);
      }
    }
  }, [profile]);

  useEffect(() => {
    if (!isLoggedIn) return;
    loadInventory().catch(() => {});
    loadTransactions().catch(() => {});
    if (role === 'Admin') {
      loadStaff().catch(() => {});
    }
  }, [isLoggedIn, role, loadInventory, loadTransactions, loadStaff]);

  const handleLogout = async () => {
    await logout();
    setShowLoginPage(false);
    setShowLogoutModal(false);
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
    };
    const doCreate = async () => {
      const created = await createTransaction(payload);
      if (created.itemId) markItemStatus(created.itemId, 'Rented');
      return created;
    };
    try {
      const created = await doCreate();
      toastSuccess('Rental created successfully');
      return created;
    } catch (err) {
      if (err.status === 404) {
        const slug = data.customer.toLowerCase().replace(/\s+/g, '_');
        await api.post('/auth/signup', {
          email: `${slug}_${Date.now()}@walkin.rentech.local`,
          password: 'temppass123',
          name: data.customer,
          phone: data.contact || '',
          address: data.address || '',
        });
        return await doCreate(); // throws naturally on failure → UI shows error, not success
      }
      throw err; // re-throw so StaffNewRental's catch handles it (no false success toast)
    }
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

  // Process return (FIX D: surface errors)
  const handleProcessReturn = async (txId, isDamaged, isLate, returnPhoto) => {
    try {
      const updated = await processReturnTx(txId, {
        returnDate: new Date().toISOString().split('T')[0],
        isDamaged: !!isDamaged,
        returnPhoto: returnPhoto || undefined,
      });
      if (updated.itemId) markItemStatus(updated.itemId, 'Cleaning');
      toastSuccess('Return processed — item moved to cleaning');
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

  // Cancel transaction (FIX D: surface errors)
  const handleCancelTransaction = async (txId) => {
    try {
      await cancelTransaction(txId);
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
      rentalFee: bookingData.amount || bookingData.rentalFee,
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
    setActiveTab('History');
  };

  // Booking submission from the rental flow — returns the created tx
  // (no navigation; the flow controls its own closing). FIX B: forwards
  // promoCode/size/measurements so the discount is persisted server-side.
  const handleSubmitBooking = async (bookingData) => {
    const created = await api.post('/bookings', {
      itemId: bookingData.itemId,
      rentalDate: bookingData.rentalDate || bookingData.date,
      dueDate: bookingData.dueDate || bookingData.returnDate,
      rentalFee: bookingData.rentalFee ?? bookingData.amount ?? 0,
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

  useEffect(() => {
    if (role) setViewRole(role);
  }, [role]);

  const handleAddStaff = (newStaff) => {
    addStaff(newStaff);
    toastSuccess('Staff account added');
  };
  const handleRemoveStaff = (staff) => {
    setStaffToRemove(staff);
  };

  // Inventory mutations are delegated to useInventory and surface failures
  // to the user (FIX: previously swallowed via console.error).
  const handleQuickStatusChange = async (itemId, status) => {
    try {
      await setItemStatus(itemId, status);
      toastSuccess(`Item marked as ${status}`);
    } catch (err) {
      toastError(err?.message || 'Failed to update item status');
    }
  };

  // Mark a returned item (currently 'Cleaning') as clean/available again.
  const markItemClean = async (itemId) => {
    await setItemStatus(itemId, 'Available');
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

  if (loading || oauthProcessing) {
    return (
      <div className="min-h-screen bg-[#fcfcfd] flex items-center justify-center">
        <SkeletonScreen />
      </div>
    );
  }

  // Google OAuth sign-up: collect missing details before completing the account.
  if (oauthDetails) {
    return (
      <GoogleSignupDetails
        email={oauthDetails.email}
        onComplete={handleOAuthDetails}
        onCancel={cancelOAuthDetails}
      />
    );
  }

  // Render: Landing -> Login -> Main App
  if (!isLoggedIn) {
    if (showLoginPage) {
       return <LoginPage />;
    }
    // Guest (public) catalog browsing — no account required to look.
    if (guestView) {
      return (
        <div className="min-h-screen bg-[#fcfcfd]">
          <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-gray-100 flex items-center justify-between px-4 py-3">
            <button onClick={() => setGuestView(false)} className="flex items-center gap-2 font-extrabold tracking-tighter text-gray-950">
              <img src="/RenTech.png" alt="RENTECH" className="w-7 h-7 rounded-lg object-contain" />
              RENTECH<span className="text-[#bf4a53]">.</span>
            </button>
            <button
              onClick={() => { setGuestView(false); setShowLoginPage(true); }}
              className="bg-gray-950 text-white px-4 py-2 rounded-full text-xs font-bold hover:bg-gray-800 transition-colors"
            >
              Sign In
            </button>
          </header>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
            <InventoryPage
              role="Customer"
              inventory={inventory}
              loading={inventoryLoading}
              guest
              onViewDetail={(item) => setDetailItem(item)}
              onGuestBook={() => { setGuestView(false); setShowLoginPage(true); }}
              onExitGuest={() => setGuestView(false)}
            />
            {detailItem && (
              <ItemDetailModal
                item={detailItem}
                guest
                onClose={() => setDetailItem(null)}
                onGuestBook={() => { setDetailItem(null); setGuestView(false); setShowLoginPage(true); }}
              />
            )}
          </div>
        </div>
      );
    }
    return (
      <LandingPage onLogin={() => setShowLoginPage(true)} onBrowse={() => setGuestView(true)} />
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
                onNavigate={setActiveTab}
                onOpenChatbot={() => setShowChatbot(true)}
                onCustomerBook={(item) => setCustomerRental({ item, date: new Date().toISOString().split('T')[0] })}
                onMarkClean={markItemClean}
              />
            )}
            {activeTab === 'Tasks' && (
              <TasksPage
                transactions={transactions}
                inventory={inventory}
                onReturn={handleReturnClick}
                onNavigate={setActiveTab}
                onRelease={handleReleaseRental}
                onMarkClean={markItemClean}
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
                onViewDetail={(item) => setDetailItem(item)}
                onEdit={setEditingItem}
                onDelete={handleDeleteInventoryItem}
                onRestore={handleRestoreInventoryItem}
                onStatusChange={handleQuickStatusChange}
                onConfirmBooking={handleCustomerBooking}
                onStaffBookItem={(item) => setStaffBookingItem(item)}
                onCheckAvailability={(item) => setCalendarItem(item)}
                onRequestDelete={(item) => setDeleteConfirm(item)}
              />
            )}
            {activeTab === 'History' && (
              <HistoryPage role={viewRole} transactions={transactions} inventory={inventory} loading={transactionsLoading} onReturn={handleReturnClick} onDelete={handleDeleteTransaction} onCancel={handleCancelTransaction} onRelease={handleReleaseRental} fetchFull={getById} />
            )}
            {activeTab === 'AI Insights' && (
              <AIInsightsView analyticsData={viewRole === 'Admin' ? <InventoryAnalyticsView noHeader /> : null} />
            )}
            {(activeTab === 'Profile' || activeTab === 'Settings') && (
              <ProfileSettingsView
                role={viewRole}
                profile={profile}
                staffList={staffAccounts}
                onAddStaff={handleAddStaff}
                onRemoveStaff={handleRemoveStaff}
                customerInfo={customerInfo}
                onUpdateCustomer={updateCustomer}
                onRequestLogout={() => setShowLogoutModal(true)}
              />
            )}
            {activeTab === 'Help' && (
              <HelpGuide role={viewRole} onStartTutorial={() => setShowOnboarding(true)} />
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
            statusOptions={['Available', 'Rented', 'Reserved', 'Cleaning', 'Maintenance', 'Damaged']}
            submitLabel="Save Changes"
            showSale={role === 'Admin'}
            onSubmit={(values) => handleUpdateItem(values)}
            onClose={() => setEditingItem(null)}
          />
        )}
        {showAddItemModal && (
          <ItemForm
            title="Add New Item"
            statusOptions={['Available', 'Cleaning', 'Maintenance', 'Damaged']}
            submitLabel="Add Item"
            showCategory
            showPhoto
            showSale={role === 'Admin'}
            maxWidth="max-w-lg"
            onSubmit={handleAddItem}
            onClose={() => setShowAddItemModal(false)}
          />
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
        <CustomerRentalFlow
          item={customerRental.item}
          selectedDate={customerRental.date}
          inventory={inventory}
          customerInfo={customerInfo}
          onClose={() => setCustomerRental(null)}
          onSubmitBooking={handleSubmitBooking}
          onCancelBooking={handleCancelBooking}
        />
        )}

        {showChatbot && (
          <ChatbotModal
            onClose={() => setShowChatbot(false)}
            inventory={inventory}
            onBook={(item) => setCustomerRental({ item })}
          />
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

        {/* Item detail / availability view (logged-in customers) */}
        {detailItem && (
          <ItemDetailModal
            item={detailItem}
            guest={false}
            onClose={() => setDetailItem(null)}
            onBook={() => {
              const it = detailItem;
              setDetailItem(null);
              setCustomerRental({ item: it, date: new Date().toISOString().split('T')[0] });
            }}
          />
        )}

        {/* Global Search Modal */}
        {showGlobalSearch && (
          <GlobalSearchModal
            transactions={transactions}
            inventory={inventory}
            onClose={() => setShowGlobalSearch(false)}
        onNavigate={(tab) => { setActiveTab(tab); setShowGlobalSearch(false); }}
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
      setActiveTab={setActiveTab}
      navItems={currentNav}
      onRequestLogout={() => setShowLogoutModal(true)}
      customerInfo={customerInfo}
      role={role}
      onOpenGlobalSearch={() => setShowGlobalSearch(true)}
      onAddItem={() => setShowAddItemModal(true)}
      onOpenSettings={() => setActiveTab('Settings')}
      onOpenHelp={() => setActiveTab('Help')}
      showNotifications={showNotifications}
      onToggleNotifications={() => setShowNotifications((s) => !s)}
      taskBadge={taskBadge}
      onFabClick={() => {
        if (viewRole === 'Admin') setActiveTab('AI Insights');
        else if (viewRole === 'Staff') setShowStaffRental(true);
        else setCustomerRental({ item: null, date: new Date().toISOString().split('T')[0] });
      }}
    >
      <Suspense fallback={<PageSkeleton tab={activeTab} />}>
        {page}
      </Suspense>
      {overlays}
    </AppLayout>
  );
}