import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ShoppingBag, Plus, Undo2, AlertTriangle, TrendingUp, User, Droplets, Tag, Copy, Check, CalendarClock, Sparkle, ScanLine } from 'lucide-react';
import ItemCard, { getSaleInfo } from '../components/ItemCard';
import CleaningQueueModal from '../components/CleaningQueueModal';
import { useTodayTasks, useKpis } from '../hooks/useDashboard';
import { DashboardSkeleton } from '../components/PageSkeletons';
import { api } from '../utils/api';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { txPill } from '../utils/statusColors';
import { promoService } from '../services/promo';
import { sortByCategory } from '../utils/categorySort';
import { tabPath } from '../utils/routing';
import { todayYmd } from '../utils/format';

export default function DashboardView({ role, transactions, inventory, transactionsLoading, inventoryLoading, customerInfo, onOpenNewRental, onNavigate, onOpenChatbot, onOpenScanner, onCustomerBook, onNavigateDetail }) {
  const navigate = useNavigate();
  // Deep-link a View All into a pre-filtered tab (same ?status= pattern the
  // Tasks queues use) instead of dumping the user on an unfiltered page.
  const goFiltered = (tab, status) => {
    navigate(`${tabPath(role, tab)}?status=${encodeURIComponent(status)}`);
  };
  const goAnchor = (tab, hash) => {
    navigate(`${tabPath(role, tab)}#${hash}`);
  };
  const todayStats = useTodayTasks(role);
  const kpis = useKpis(role);
  const { qr_codes: qrCodesOn } = useFeatureFlags();
  const [showCleaningQueue, setShowCleaningQueue] = useState(false);

  // Live promo codes for the customer "Promotions & Offers" section.
  const [promos, setPromos] = useState([]);
  const [promosLoading, setPromosLoading] = useState(role === 'Customer');
  const [copiedCode, setCopiedCode] = useState(null);
  useEffect(() => {
    if (role !== 'Customer') return;
    let active = true;
    promoService.listPublic()
      .then((d) => { if (active && Array.isArray(d)) setPromos(d); })
      .catch(() => {})
      .finally(() => { if (active) setPromosLoading(false); });
    return () => { active = false; };
  }, [role]);

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // clipboard API may be unavailable (http); fall through silently
    }
    setCopiedCode(code);
    setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1600);
  };
  // If the server KPIs/today-digest never resolve (e.g. API unreachable), stop
  // holding the skeleton after a few seconds and fall back to client-derived
  // numbers instead of blocking the dashboard forever.
  const [serverDataTimedOut, setServerDataTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setServerDataTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, []);

  // Admin bulk-clean action — mirror of what Staff do in Tasks, available
  // directly from the dashboard modal so the admin never has to switch pages.
  // inventory prop is refreshed after a successful bulk update by the parent.
  const handleBulkClean = async (ids) => {
    await api.patch('/inventory/bulk-status', { ids, status: 'Available' });
  };

  // Normalize customer/item to a display name — client transactions carry a
  // string, while server /dashboard/today returns { id, name, phone } objects.
  const custName = (tx) => (typeof tx.customer === 'string' ? tx.customer : tx.customer?.name) || 'Customer';
  const itemName = (tx) => (typeof tx.item === 'string' ? tx.item : tx.item?.name) || 'Item';
  // Customer view
  if (role === 'Customer') {
    const available = inventory.filter((i) => i.status === 'Available');
    const prefs = customerInfo?.preferences || [];
    const preferred = available.filter((i) =>
      prefs.some((p) => (i.category || '').toLowerCase().includes(p.toLowerCase()))
    );
    const recommended = sortByCategory(prefs.length > 0 && preferred.length > 0 ? preferred : available).slice(0, 4);
    const myRentals = (transactions || [])
      .filter((tx) => tx.status === 'Active' || tx.status === 'Overdue' || tx.status === 'Reserved')
      .slice(0, 3);
    const onSale = available
      .filter((i) => getSaleInfo(i).active)
      .slice(0, 4);
    const itemName = (tx) => (typeof tx.item === 'string' ? tx.item : tx.item?.name) || 'Item';

    // New arrivals — newest available items this customer may not have seen.
    const newArrivals = sortByCategory([...available]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    ).slice(0, 4);

    // Upcoming rentals (Reserved/Active with a future pickup) so the customer
    // sees at a glance what to pick up and when.
    const upcoming = (transactions || [])
      .filter((tx) => (tx.status === 'Reserved' || tx.status === 'Active') && tx.rentalDate)
      .sort((a, b) => new Date(a.rentalDate) - new Date(b.rentalDate))
      .slice(0, 3);

    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Hero */}
        <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-3xl p-8 border border-red-100/50 shadow-sm relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-white/40 rounded-full blur-3xl" />
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 mb-3 relative z-10">
            {customerInfo?.name ? `Hi ${customerInfo.name.split(' ')[0]}, find your ` : 'Find your '}
            <span className="text-[#bf4a53]">perfect fit.</span>
          </h2>
          <p className="text-gray-600 text-sm mb-8 max-w-sm relative z-10 leading-relaxed font-medium">
            Describe your event theme or style preference, and let our AI stylist curate the ideal outfit.
          </p>
          <button onClick={onOpenChatbot}
            className="bg-[#bf4a53] text-white px-6 py-3 rounded-full text-sm font-semibold shadow-md shadow-red-500/20 flex items-center gap-2 hover:bg-red-700 transition-colors relative z-10">
            <Sparkles size={16} /> Consult AI Stylist
          </button>
        </div>

        {/* Promotions & Offers — real promo codes (admin-created) + sale items */}
        {(promosLoading || promos.length > 0 || onSale.length > 0) && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Tag size={18} className="text-[#bf4a53]" /> Promotions & Offers
                </h3>
                <p className="text-xs text-gray-500">Discounts you can use on your next booking</p>
              </div>
            </div>

            {/* Promo codes — skeleton placeholders so the section renders on
                first paint instead of popping in after the fetch resolves */}
            {promosLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-4">
                    <div className="w-24 h-6 bg-gray-200 rounded animate-pulse mb-2" />
                    <div className="w-32 h-3 bg-gray-200 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : (
              promos.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
                  {promos.map((p) => (
                    <div key={p.code} className="relative overflow-hidden rounded-2xl border-2 border-dashed border-[#bf4a53]/30 bg-gradient-to-br from-red-50 to-orange-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xl font-extrabold text-[#bf4a53]">{p.discountPct}% OFF</p>
                          <p className="text-[11px] text-gray-500 font-medium">
                            {p.expiresAt ? `Until ${new Date(p.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No expiry'}
                          </p>
                        </div>
                        <button
                          onClick={() => copyCode(p.code)}
                          className="flex items-center gap-1.5 bg-white border border-[#bf4a53]/30 text-gray-900 px-3 py-2 rounded-xl font-mono font-bold text-sm hover:bg-[#bf4a53] hover:text-white transition-colors shrink-0"
                          title="Copy code"
                        >
                          {copiedCode === p.code ? <Check size={14} /> : <Copy size={14} />}
                          {p.code}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Sale items pulled into the promo section */}
            {onSale.length > 0 && (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {onSale.map((item) => (
                  <ItemCard key={item.id} item={item} role={role} onBook={() => onCustomerBook(item)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upcoming — a quick heads-up of what to pick up / when, filling the gap
            when the customer has rentals in flight but nothing else to show. */}
        {upcoming.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                <CalendarClock size={15} className="text-[#bf4a53]" /> Upcoming Pickups
              </h3>
              <button onClick={() => onNavigate('History')} className="text-xs font-semibold text-[#bf4a53] hover:underline">View All</button>
            </div>
            <div className="space-y-3">
              {upcoming.map((tx) => (
                <div key={tx.id} className="bg-white rounded-2xl p-4 border border-gray-100/80 shadow-sm flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                    <ShoppingBag size={16} className="text-[#bf4a53]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{itemName(tx)}</p>
                    <p className="text-xs text-gray-500 truncate">Pickup {new Date(tx.rentalDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${txPill(tx.status).bg} ${txPill(tx.status).text}`}>{tx.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommended for You — personalized */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Recommended for You</h3>
              <p className="text-xs text-gray-500">{prefs.length > 0 ? 'Based on your interests' : 'Popular picks'}</p>
            </div>
            <button onClick={() => onNavigate('Catalog')} className="text-sm font-semibold text-gray-500 hover:text-[#bf4a53] transition-colors">View All</button>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {recommended.map((item) => (
              <ItemCard key={item.id} item={item} role={role} onBook={() => onCustomerBook(item)} />
            ))}
          </div>
        </div>

        {/* On Sale items already surfaced inside "Promotions & Offers" above —
            removed the standalone duplicate block. */}

        {/* New Arrivals — helps discovery beyond recommendations */}
        {newArrivals.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Sparkle size={18} className="text-[#bf4a53]" /> New Arrivals
                </h3>
                <p className="text-xs text-gray-500">Fresh additions to the collection</p>
              </div>
              <button onClick={() => onNavigate('Catalog')} className="text-sm font-semibold text-gray-500 hover:text-[#bf4a53] transition-colors">View All</button>
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              {newArrivals.map((item) => (
                <ItemCard key={item.id} item={item} role={role} onBook={() => onCustomerBook(item)} />
              ))}
            </div>
          </div>
        )}

        {/* Your Rentals */}
        {myRentals.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Your Rentals</h3>
              <button onClick={() => onNavigate('History')} className="text-xs font-semibold text-[#bf4a53] hover:underline">View All</button>
            </div>
            <div className="space-y-3">
              {myRentals.map((tx) => (
                <div key={tx.id} className="bg-white rounded-2xl p-4 border border-gray-100/80 shadow-sm flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                    <ShoppingBag size={16} className="text-[#bf4a53]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{itemName(tx)}</p>
                    <p className="text-xs text-gray-500 truncate">Due {tx.dueDate ? new Date(tx.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${txPill(tx.status).bg} ${txPill(tx.status).text}`}>{tx.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* End of results */}
        <p className="text-center text-xs text-gray-400 pt-4 pb-2">You've reached the end of your feed</p>
      </div>
    );
  }

  // Computed data (FIX G: prefer server-authoritative /dashboard/today when loaded)
  const today = new Date();
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);

  // Today's due returns (FIX G: from server when available)
  const todayStr = todayYmd();
  const upcomingToday = todayStats
    ? todayStats.dueToday.slice(0, 3)
    : transactions.filter(tx =>
        tx.status === 'Active' && tx.dueDate && tx.dueDate.split('T')[0] <= todayStr
      ).slice(0, 3);

  // Collected today: server-computed from the payments ledger (same
  // definition as the Monthly Revenue card). Today-digest first (both staff
  // + admin load it), then admin KPIs, then the legacy client-side fallback.
  // The old derivation summed BOOKED fees, which read ₱0 on days with no new
  // bookings even when cash was collected — and counted unpaid bookings.
  const revenueToday = todayStats?.todayRevenue ?? kpis?.todayRevenue ?? transactions
    .filter(tx => tx.date && new Date(tx.date).toDateString() === today.toDateString())
    .reduce((sum, tx) => sum + (tx.rentalFee || 0), 0);

  // Staff dashboard — same skeleton-gate discipline as the admin branch
  // below. Without it the first paint derives KPIs from the hooks' initial
  // empty arrays and flashes "No returns due today / Nothing urgent" before
  // the server data arrives (false-empty bug).
  const staffInitialLoad =
    (transactionsLoading && (!transactions || transactions.length === 0)) ||
    (inventoryLoading && (!inventory || inventory.length === 0));
  if (role === 'Staff' && staffInitialLoad) {
    return <DashboardSkeleton />;
  }
  if (role === 'Staff') {
    const overdueCount = todayStats ? todayStats.overdue.length : transactions.filter(tx =>
      tx.status === 'Overdue' || (tx.status === 'Active' && new Date(tx.dueDate || tx.date) < dayStart)
    ).length;
    const availableCount = inventory.filter(i => i.status === 'Available').length;
    const cleaningCount = todayStats ? todayStats.inCleaning : inventory.filter(i => i.status === 'Cleaning').length;
    const recentRentals = transactions.filter(tx => tx.status === 'Active' || tx.status === 'Overdue').slice(0, 3);
    // Desktop-only extras (staff benefit data)
    const pickupsToday = transactions.filter(tx => {
      if (!tx.rentalDate || (tx.status !== 'Reserved' && tx.status !== 'Active')) return false;
      return new Date(tx.rentalDate).toDateString() === today.toDateString();
    });
    const overdueTxs = transactions.filter(tx =>
      tx.status === 'Overdue' || (tx.status === 'Active' && new Date(tx.dueDate || tx.date) < dayStart)
    ).slice(0, 3);
    const daysLate = (tx) => tx.dueDate ? Math.max(1, Math.ceil((today - new Date(tx.dueDate)) / 86400000)) : '?';
    return (
      <div className="max-w-lg mx-auto md:max-w-3xl xl:max-w-[1200px]">
        {/* Header (mobile/tablet) — unchanged */}
        <div className="flex items-center justify-between mb-5 md:mb-6 xl:hidden">
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Staff Dashboard</h2>
            <p className="text-sm text-gray-500 mt-0.5">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>

        {/* Desktop header band */}
        <header className="hidden xl:flex items-center justify-between mb-7 pb-5 border-b border-gray-200/80">
          <div>
            <h2 className="text-[28px] leading-tight font-bold text-gray-900 tracking-tight">Staff Dashboard</h2>
            <p className="text-sm text-gray-500 mt-1">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
        </header>

        {/* Desktop bento grid — mobile/tablet/iPad get the stacked layout with
            more vertical breathing room (iPad trips lg, so bento waits for xl) */}
        <div className="space-y-5 md:space-y-7 pt-2 xl:pt-0 xl:space-y-0 xl:grid xl:grid-cols-12 xl:gap-6 xl:items-start">

        {/* KPI row — 2x2 on mobile, 4 across on tablet/desktop */}
        <div className="xl:col-span-12 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 xl:gap-5">
          <button onClick={() => onNavigate('History')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Pickups Today</p>
            <p className="text-2xl lg:text-3xl font-extrabold text-gray-900 mt-1">{pickupsToday.length}</p>
          </button>
          <button onClick={() => onNavigate('Tasks')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              {overdueCount > 0 ? <span className="text-red-500">Overdue</span> : 'Overdue'}
            </p>
            <p className={`text-2xl lg:text-3xl font-extrabold mt-1 ${overdueCount > 0 ? 'text-red-500' : 'text-gray-900'}`}>{overdueCount}</p>
          </button>
          <button onClick={() => onNavigate('Catalog')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Available</p>
            <p className="text-2xl lg:text-3xl font-extrabold text-gray-900 mt-1">{availableCount}</p>
          </button>
          <button onClick={() => onNavigate('Tasks')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              {cleaningCount > 0 ? <span className="text-orange-500">In Cleaning</span> : 'In Cleaning'}
            </p>
            <p className={`text-2xl lg:text-3xl font-extrabold mt-1 ${cleaningCount > 0 ? 'text-orange-500' : 'text-gray-900'}`}>{cleaningCount}</p>
          </button>
        </div>

        {/* Right rail: Quick Actions + (desktop) Today at a Glance + Overdue Follow-ups */}
        <aside className="xl:col-span-3 xl:col-start-10 xl:row-start-2 xl:row-span-3 xl:self-start space-y-4 md:space-y-6 xl:space-y-6">

          {/* Quick Actions panel */}
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 flex flex-col gap-3 xl:gap-4">
            <p className="hidden xl:block text-[11px] font-bold text-gray-400 uppercase tracking-widest -mb-1">Quick Actions</p>
            {/* Primary CTA */}
            <button data-tour="new-rental" onClick={onOpenNewRental}
              className="w-full flex items-center justify-center gap-3 bg-[#bf4a53] text-white font-bold text-base xl:text-[15px] py-5 xl:py-3.5 rounded-2xl xl:rounded-xl shadow-lg shadow-red-500/20 hover:bg-red-700 btn-press transition-all min-h-[56px] xl:min-h-0">
              <Plus size={22} strokeWidth={3} />
              New Rental
            </button>
            {/* Secondary CTA */}
            <button data-tour="returns" onClick={() => onNavigate('History')}
              className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 xl:border-gray-200 text-gray-900 font-bold text-base xl:text-[15px] py-4 xl:py-3.5 rounded-2xl xl:rounded-xl hover:bg-gray-50 btn-press transition-all min-h-[56px] xl:min-h-0 shadow-sm xl:shadow-none">
              <Undo2 size={20} />
              Process Return
            </button>
            {/* Scan QR (visible only while the QR-codes flag is ON) */}
            {qrCodesOn && onOpenScanner && (
              <button onClick={onOpenScanner}
                className="w-full flex items-center justify-center gap-3 bg-white border-2 border-dashed border-gray-300 text-gray-700 font-bold text-base xl:text-[15px] py-4 xl:py-3 rounded-2xl xl:rounded-xl hover:bg-gray-50 btn-press transition-all min-h-[56px] xl:min-h-0 shadow-sm xl:shadow-none">
                <ScanLine size={20} />
                Scan QR
              </button>
            )}
          </div>

          {/* Today at a Glance (desktop only) */}
          <div className="hidden xl:block bg-white rounded-2xl border border-gray-100/80 shadow-sm p-5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Today at a Glance</p>
            <div className="flex items-center gap-2 text-gray-900">
              <TrendingUp size={18} className="text-emerald-500 shrink-0" />
              <p className="text-sm font-bold">₱{revenueToday.toLocaleString()}</p>
              <p className="text-xs text-gray-400 font-medium">collected today</p>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5 text-xs text-gray-500 font-medium">
              <p><span className="font-bold text-gray-800">{upcomingToday.length}</span> return{upcomingToday.length === 1 ? '' : 's'} due today</p>
              <p><span className="font-bold text-gray-800">{pickupsToday.length}</span> pickup{pickupsToday.length === 1 ? '' : 's'} scheduled</p>
              <p><span className="font-bold text-gray-800">{cleaningCount}</span> item{cleaningCount === 1 ? '' : 's'} in cleaning</p>
            </div>
          </div>

          {/* Overdue Follow-ups (desktop only) */}
          {overdueCount > 0 && (
            <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-bold text-red-400 uppercase tracking-widest">Follow Up</p>
                <button onClick={() => goFiltered('History', 'Overdue')} className="text-xs font-semibold text-[#bf4a53] hover:underline">View All</button>
              </div>
              <div className="space-y-2.5">
                {overdueTxs.map(tx => (
                  <div key={tx.id}
                    onClick={() => { if (onNavigateDetail) onNavigateDetail(tx); }}
                    title={onNavigateDetail ? 'View transaction details' : undefined}
                    className={onNavigateDetail ? 'flex items-center justify-between gap-2 cursor-pointer hover:bg-red-50/60 -mx-1 px-1 rounded-lg transition-colors' : 'flex items-center justify-between gap-2'}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{custName(tx)}</p>
                      <p className="text-xs text-gray-500 truncate">{itemName(tx)}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">{daysLate(tx)}d late</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </aside>

        {/* Upcoming Today — main column */}
        <div className="xl:col-span-9 xl:col-start-1 bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 xl:p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Upcoming Today</h3>
            {upcomingToday.length > 0 && (
              <button onClick={() => onNavigate('Tasks')}
                className="text-xs font-semibold text-[#bf4a53] hover:underline">
                View All
              </button>
            )}
          </div>
          {upcomingToday.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-400 font-medium">No returns due today.</p>
            </div>
          ) : (
            <div className="space-y-3 stagger">
              {upcomingToday.map(tx => (
                <div key={tx.id} className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
                  <div className="w-10 h-10 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-400 shrink-0">
                    <User size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{custName(tx)}</p>
                    <p className="text-xs text-gray-500 truncate">{itemName(tx)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-semibold text-gray-500">Due: {tx.dueDate ? new Date(tx.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today'}</p>
                  </div>
                  </div>
                ))}
              </div>
            )}
        </div>



        {/* Active Rentals — main column */}
        {recentRentals.length > 0 && (
          <div className="xl:col-span-9 xl:col-start-1 bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 xl:p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Active Rentals</h3>
              <button onClick={() => onNavigate('History')}
                className="text-xs font-semibold text-[#bf4a53] hover:underline">
                View All
              </button>
            </div>
            <div className="space-y-3">
              {recentRentals.map(tx => (
                <div key={tx.id}
                  onClick={() => { if (onNavigateDetail) onNavigateDetail(tx); }}
                  title={onNavigateDetail ? 'View transaction details' : undefined}
                  className={`flex items-center gap-3 py-3 border-b border-gray-100 last:border-0 ${onNavigateDetail ? 'cursor-pointer hover:bg-gray-50/70 -mx-2 px-2 rounded-xl transition-colors' : ''}`}>
                  <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                    <ShoppingBag size={16} className="text-[#bf4a53]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{custName(tx)}</p>
                    <p className="text-xs text-gray-500 truncate">{itemName(tx)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${txPill(tx.status).bg} ${txPill(tx.status).text}`}>
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Needs Attention — sidebar column, row 3 (desktop) / inline (mobile) */}
        {(() => {
          const attentionItems = inventory
            .filter(i => i.status === 'OutOfService')
            .slice(0, 3);
          if (attentionItems.length === 0) return null;
          return (
            <div className="xl:col-span-9 xl:col-start-1 bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 xl:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Needs Attention</h3>
                <button onClick={() => goFiltered('Catalog', 'OutOfService')} className="text-xs font-semibold text-[#bf4a53] hover:underline">
                  Manage Inventory
                </button>
              </div>
              <div className="space-y-3">
                {attentionItems.map(item => (
                  <div key={item.id} className="bg-gray-50/50 rounded-xl p-3 border border-gray-100 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                      <AlertTriangle size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{item.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        <span className="font-semibold text-red-600">Out of Service</span>
                        {item.outOfServiceReason ? ` · ${item.outOfServiceReason}` : ''}
                      </p>
                    </div>
                    <button onClick={() => goFiltered('Catalog', 'OutOfService')} className="shrink-0 text-xs font-bold bg-white border border-gray-200 text-gray-900 px-3 py-1.5 rounded-full hover:bg-gray-100 transition-colors shadow-sm">
                      Fix
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Cleaning reminder — staff jumps straight to the In Cleaning card on
            Tasks (scrolls there); full queue lives there */}
        {role === 'Staff' && cleaningCount > 0 && (
          <div className="xl:col-span-9 xl:col-start-1 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Droplets size={16} className="text-orange-500 shrink-0" />
              <p className="text-sm font-semibold text-gray-800 truncate">
                {cleaningCount} item{cleaningCount === 1 ? '' : 's'} awaiting cleaning
              </p>
            </div>
            <button onClick={() => goAnchor('Tasks', 'cleaning-queue')}
              className="shrink-0 text-xs font-bold text-orange-700 bg-white border border-orange-200 px-3 py-1.5 rounded-full hover:bg-orange-100 transition-colors">
              Cleaning Queue
            </button>
          </div>
        )}
        </div>
      </div>
    );
  }

  // ---------- Admin dashboard ----------
  // Server-backed KPIs are cached (server + SWR client), so on revisits this
  // gate resolves instantly. On the very first load it holds the skeleton until
  // both the KPI numbers and the today-digest arrive, so the cards paint once
  // with real values instead of client-derived fallbacks that swap in late.
  if (role === 'Admin' && !serverDataTimedOut && (!kpis || !todayStats)) {
    return <DashboardSkeleton />;
  }
  // Business KPIs come from the server (/dashboard/today + /dashboard/kpis) with
  // client-side fallbacks; the layout reuses the staff dashboard's visual language.
  const overdueCount = todayStats ? todayStats.overdue.length : transactions.filter(tx =>
    tx.status === 'Overdue' || (tx.status === 'Active' && new Date(tx.dueDate || tx.date) < dayStart)
  ).length;
  const availableCount = inventory.filter(i => i.status === 'Available').length;
  // Client-derived (not the KPI) so it stays in sync with the inventory that
  // the Cleaning Queue modal reads — otherwise the card would show a stale count
  // for up to 60s after a bulk clean.
  const cleaningCount = inventory.filter(i => i.status === 'Cleaning').length;
  const pickupsToday = transactions.filter(tx => {
    if (!tx.rentalDate || (tx.status !== 'Reserved' && tx.status !== 'Active')) return false;
    return new Date(tx.rentalDate).toDateString() === today.toDateString();
  });
  const overdueTxs = transactions.filter(tx =>
    tx.status === 'Overdue' || (tx.status === 'Active' && new Date(tx.dueDate || tx.date) < dayStart)
  ).slice(0, 3);
  const daysLate = (tx) => tx.dueDate ? Math.max(1, Math.ceil((today - new Date(tx.dueDate)) / 86400000)) : '?';
  const onSaleCount = inventory.filter(i => getSaleInfo(i).active).length;

  const k = kpis || {};
  const monthlyRevenue = k.monthlyRevenue ?? transactions
    .filter(tx => { const d = new Date(tx.date); return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth(); })
    .reduce((sum, tx) => sum + (tx.rentalFee || 0), 0);
  const prevMonthRevenue = k.prevMonthRevenue ?? 0;
  const revDiff = monthlyRevenue - prevMonthRevenue;
  const activeRentals = k.activeRentals ?? transactions.filter(tx => tx.status === 'Active').length;
  const overdueReturns = k.overdueReturns ?? transactions.filter(tx => tx.status === 'Overdue').length;
  const returnedCount = k.returnedCount ?? transactions.filter(tx => tx.status === 'Returned').length;
  const cancelledCount = k.cancelledCount ?? transactions.filter(tx => tx.status === 'Cancelled').length;
  const totalItems = k.totalItems ?? inventory.length;
  const availableItems = k.availableItems ?? availableCount;
  const utilizationRate = k.utilizationRate ?? (totalItems > 0 ? Math.round(((totalItems - availableItems) / totalItems) * 100) : 0);
  const returnedRate = k.returnedRate ?? 0;
  const cancellationRate = k.cancellationRate ?? 0;
  const overdueRate = k.overdueRate ?? (overdueReturns + returnedCount > 0 ? Math.round((overdueReturns / (overdueReturns + returnedCount)) * 100) : 0);
  const damagedItems = k.damagedItems ?? inventory.filter(i => i.status === 'OutOfService').length;

  // Revenue Trend: collected payments only, from the server (same definition
  // as the Monthly Revenue card). The old client-side sum of booked rental
  // fees disagreed with the card (fees ≠ money collected) — e.g. Oct spiking
  // on unpaid bookings while the card showed Sept's real collections.
  const revByMonth = Array.isArray(k.revenueTrend) && k.revenueTrend.length > 0
    ? k.revenueTrend
    : (() => {
        const fallback = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
          const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
          fallback.push({ label, revenue: 0 });
        }
        return fallback;
      })();
  // Cap the visual scale so an extreme outlier month doesn't squash every other
  // month into invisible slivers. =5x the median of non-zero months, the bar
  // is rendered at 60% height and marked as "capped"; the label still shows the
  // true value so the data is never falsified.
  const maxRevenue = Math.max(...revByMonth.map(m => m.revenue), 1);
  const nonZero = revByMonth.map(m => m.revenue).filter(r => r > 0);
  const medianRevenue = nonZero.length > 0
    ? [...nonZero].sort((a, b) => a - b)[Math.floor(nonZero.length / 2)]
    : 0;
  const rawVisualCap = medianRevenue * 5;
  const isOutlier = (rev) => rev > 0 && rawVisualCap > 0 && rev > rawVisualCap;
  const visualCap = isOutlier(maxRevenue) ? rawVisualCap : maxRevenue;

  const itemCounts = {};
  transactions.forEach(tx => {
    const n = itemName(tx);
    if (n !== 'Item') itemCounts[n] = (itemCounts[n] || 0) + 1;
  });
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxTop = topItems.length > 0 ? topItems[0][1] : 1;

  return (
    <div className="max-w-lg mx-auto md:max-w-3xl xl:max-w-[1200px]">
      {/* Header (mobile/tablet) */}
      <div className="flex items-center justify-between mb-5 md:mb-6 xl:hidden">
        <div>
          <h2 className="text-xl font-bold text-gray-900 tracking-tight">Admin Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      {/* Desktop header band */}
      <header className="hidden xl:flex items-center justify-between mb-7 pb-5 border-b border-gray-200/80">
        <div>
          <h2 className="text-[28px] leading-tight font-bold text-gray-900 tracking-tight">Admin Dashboard</h2>
          <p className="text-sm text-gray-500 mt-1">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
      </header>

      <div className="space-y-5 md:space-y-7 pt-2 xl:pt-0 xl:space-y-0 xl:grid xl:grid-cols-12 xl:gap-6 xl:items-start">

        {/* KPI row — 2x2 on mobile, 4 across on tablet/desktop */}
        <div className="xl:col-span-12 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 xl:gap-5">
          <button onClick={() => onNavigate('AI Insights')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Monthly Revenue</p>
            <p className="text-2xl lg:text-3xl font-extrabold text-gray-900 mt-1">₱{monthlyRevenue.toLocaleString()}</p>
            <p className={`text-[10px] font-bold mt-0.5 ${revDiff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {revDiff >= 0 ? '+' : '-'}₱{Math.abs(revDiff).toLocaleString()} vs last month
            </p>
          </button>
          <button onClick={() => goFiltered('History', overdueReturns > 0 ? 'Overdue' : 'Active')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Active Rentals</p>
            <p className={`text-2xl lg:text-3xl font-extrabold mt-1 ${overdueReturns > 0 ? 'text-red-500' : 'text-gray-900'}`}>{activeRentals}</p>
            <p className={`text-[10px] font-bold mt-0.5 ${overdueReturns > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
              {overdueReturns > 0 ? `${overdueReturns} overdue` : 'all on time'}
            </p>
          </button>
          <button onClick={() => onNavigate('Tasks')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Due Today</p>
            <p className="text-2xl lg:text-3xl font-extrabold text-gray-900 mt-1">{todayStats ? todayStats.dueToday.length : upcomingToday.length}</p>
            <p className="text-[10px] font-bold mt-0.5 text-gray-400">returns due</p>
          </button>
          <button onClick={() => onNavigate('Catalog')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Utilization</p>
            <p className={`text-2xl lg:text-3xl font-extrabold mt-1 ${availableItems < 5 ? 'text-orange-500' : 'text-gray-900'}`}>{utilizationRate}%</p>
            <p className="text-[10px] font-bold mt-0.5 text-gray-400">{availableItems} of {totalItems} items free</p>
          </button>
        </div>

        {/* Left column — Revenue Trend + Top Items + Overdue follow-ups */}
        <div className="xl:col-span-9 space-y-4 md:space-y-6 xl:space-y-6">
          {/* Revenue Trend (6 months) */}
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 xl:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Revenue Trend</h3>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">₱{revenueToday.toLocaleString()} collected today</span>
            </div>
            <div className="h-36 flex items-end justify-between gap-2">
              {revByMonth.map((m, idx) => {
                const isEmpty = m.revenue <= 0;
                const capped = isOutlier(m.revenue);
                const pct = (m.revenue / visualCap) * 100;
                return (
                  <div key={`${m.label}-${idx}`} title={capped ? `₱${m.revenue.toLocaleString()} (bar truncated — outlier month)` : `₱${m.revenue.toLocaleString()}`}
                    className="flex-1 flex flex-col items-center justify-end h-full group">
                    <span className={`text-[10px] font-semibold mb-1 transition-opacity ${
                      isEmpty ? 'text-gray-300' : 'text-gray-500 opacity-0 group-hover:opacity-100'}`}>
                      {isEmpty ? '₱0' : `₱${m.revenue.toLocaleString()}${capped ? ' ↑' : ''}`}
                    </span>
                    {/* Empty months: dashed placeholder bar. Outlier months: capped at 60% with
                        a dashed cap so the scale stays readable; the true value is in the label. */}
                    <div
                      className={`w-full rounded-t-lg transition-all duration-500 ${
                        isEmpty
                          ? 'bg-gray-50 border border-dashed border-gray-300 group-hover:border-gray-400'
                          : capped
                            ? 'bg-[#bf4a53]/20 border-2 border-dashed border-[#bf4a53]/40 group-hover:bg-[#bf4a53]/30 cursor-pointer'
                            : 'bg-[#bf4a53]/15 group-hover:bg-[#bf4a53]/30 cursor-pointer'
                      }`}
                      style={{ height: capped ? '60%' : isEmpty ? '12%' : `${pct}%`, minHeight: '4px' }}
                    />
                    <span className={`text-[9px] font-semibold mt-1.5 ${isEmpty ? 'text-gray-300' : capped ? 'text-[#bf4a53]/60' : 'text-gray-400'}`}>{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Rented Items */}
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 xl:p-6">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Top Rented Items</h3>
            {topItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6 font-medium">No rental data yet.</p>
            ) : (
              <div className="space-y-3.5">
                {topItems.map(([name, count]) => {
                  // Tied counts share the same rank (rank = 1 + items strictly ahead).
                  const rank = topItems.findIndex(([, c]) => c === count) + 1;
                  return (
                  <div key={name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700 truncate flex-1">{rank}. {name}</span>
                      <span className="font-bold text-gray-900 ml-2">{count}x</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-[#bf4a53]" style={{ width: `${Math.min((count / maxTop) * 100, 100)}%` }} />
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cleaning Queue Health — admin-beneficial operational KPI */}
          {cleaningCount > 0 && (() => {
            const oldest = inventory
              .filter(i => i.status === 'Cleaning')
              .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt))[0];
            const daysWaiting = oldest ? Math.max(1, Math.ceil((today - new Date(oldest.updatedAt)) / 86400000)) : null;
            return (
              <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 xl:p-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Cleaning Queue</h3>
                  <button onClick={() => setShowCleaningQueue(true)} className="text-xs font-semibold text-[#bf4a53] hover:underline">View Queue</button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center shrink-0">
                    <Droplets size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-2xl font-extrabold text-gray-900">{cleaningCount}
                      <span className="text-sm font-medium text-gray-400 ml-1.5">item{cleaningCount === 1 ? '' : 's'} awaiting cleaning</span>
                    </p>
                    {daysWaiting !== null && (
                      <p className={`text-xs mt-0.5 font-semibold ${daysWaiting >= 3 ? 'text-red-500' : daysWaiting >= 2 ? 'text-orange-500' : 'text-gray-500'}`}>
                        Oldest in queue: {daysWaiting}d
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Right rail — Business Health + Inventory Health + AI Insights */}
        <aside className="xl:col-span-3 xl:self-start space-y-4 md:space-y-6 xl:space-y-6">

          {/* Business Health */}
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Business Health</p>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 font-medium">Collected today</span>
                <span className="font-bold text-gray-900">₱{revenueToday.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 font-medium">Pickups scheduled</span>
                <span className="font-bold text-gray-900">{pickupsToday.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 font-medium">Overdue returns</span>
                <span className={`font-bold ${overdueCount > 0 ? 'text-red-500' : 'text-gray-900'}`}>{overdueCount}</span>
              </div>
              <div className="pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-gray-500 font-medium">Utilization</span>
                  <span className="font-bold text-gray-900">{utilizationRate}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className={`h-2 rounded-full ${utilizationRate > 85 ? 'bg-orange-400' : 'bg-emerald-500'}`} style={{ width: `${utilizationRate}%` }} />
                </div>
              </div>
            </div>
            <p className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-500 font-medium">
              {returnedRate}% returned · {overdueRate}% overdue · {cancellationRate}% cancelled
            </p>
          </div>

          {/* Inventory Health */}
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Inventory Health</p>
              <button onClick={() => onNavigate('Catalog')} className="text-[11px] font-bold text-[#bf4a53] bg-[#bf4a53]/5 hover:bg-[#bf4a53]/10 active:scale-[0.97] px-3 py-1.5 rounded-full transition-all">Manage</button>
            </div>
            {/* Available hero */}
            <div className="rounded-2xl bg-emerald-50/60 border border-emerald-100/70 p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-2xl font-extrabold text-gray-900 tabular-nums">
                  {availableItems}<span className="text-sm font-medium text-gray-400">/{totalItems}</span>
                </p>
                <p className="text-[11px] font-bold text-emerald-600 whitespace-nowrap">
                  {totalItems > 0 ? Math.round((availableItems / totalItems) * 100) : 0}% available
                </p>
              </div>
              <div className="w-full bg-white rounded-full h-2 mt-2 overflow-hidden">
                <div
                  className="h-2 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${totalItems > 0 ? Math.round((availableItems / totalItems) * 100) : 0}%` }}
                />
              </div>
            </div>
            {/* Attention tiles */}
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="rounded-2xl bg-gray-50/70 border border-gray-100 p-2.5 text-center min-w-0">
                <p className={`text-lg font-extrabold tabular-nums ${cleaningCount > 0 ? 'text-orange-500' : 'text-gray-300'}`}>{cleaningCount}</p>
                <p className="text-[10px] font-semibold text-gray-500 leading-tight mt-0.5">In cleaning</p>
              </div>
              <div className="rounded-2xl bg-gray-50/70 border border-gray-100 p-2.5 text-center min-w-0">
                <p className={`text-lg font-extrabold tabular-nums ${damagedItems > 0 ? 'text-red-500' : 'text-gray-300'}`}>{damagedItems}</p>
                <p className="text-[10px] font-semibold text-gray-500 leading-tight mt-0.5">Out of service</p>
              </div>
              <div className="rounded-2xl bg-gray-50/70 border border-gray-100 p-2.5 text-center min-w-0">
                <p className={`text-lg font-extrabold tabular-nums ${onSaleCount > 0 ? 'text-[#bf4a53]' : 'text-gray-300'}`}>{onSaleCount}</p>
                <p className="text-[10px] font-semibold text-gray-500 leading-tight mt-0.5">On sale</p>
              </div>
            </div>
          </div>

          {/* AI Insights */}
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-red-50 text-[#bf4a53] rounded-xl"><Sparkles size={16} /></div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">AI Insights</p>
            </div>
            <div className="p-3.5 bg-gray-50/80 rounded-2xl border border-gray-100/50">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle size={15} className={overdueCount > 0 ? 'text-red-500' : 'text-emerald-500'} />
                <span className="font-bold text-gray-900 text-[13px]">{overdueCount > 0 ? `${overdueCount} Overdue` : 'All Clear'}</span>
              </div>
              <p className="text-[13px] text-gray-700 leading-relaxed">
                {overdueCount > 0 ? (
                  <>Action needed — <button onClick={() => goFiltered('History', 'Overdue')} className="font-bold text-[#bf4a53] hover:underline">review overdue returns</button>.</>
                ) : 'All returns are on track.'}
              </p>
            </div>
            <button onClick={() => onNavigate('AI Insights')}
              className="w-full mt-4 bg-white border border-gray-200 text-gray-800 font-semibold text-sm py-2.5 rounded-full hover:bg-gray-50 transition-colors shadow-sm">
              Full Report
            </button>
          </div>
        </aside>
      </div>

      {/* Admin Cleaning Queue modal — view the backlog and bulk-mark items cleaned
          without switching to the Staff Tasks page. */}
      {showCleaningQueue && (
        <CleaningQueueModal
          items={inventory.filter(i => i.status === 'Cleaning')}
          onClose={() => setShowCleaningQueue(false)}
          onBulkClean={handleBulkClean}
        />
      )}
    </div>
  );
}