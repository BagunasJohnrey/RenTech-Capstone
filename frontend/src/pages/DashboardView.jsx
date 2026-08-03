import { Sparkles, ShoppingBag, Plus, Undo2, AlertTriangle, TrendingUp, User, Droplets } from 'lucide-react';
import ItemCard, { getSaleInfo } from '../components/ItemCard';
import { useTodayTasks, useKpis } from '../hooks/useDashboard';
import { txPill } from '../utils/statusColors';

export default function DashboardView({ role, transactions, inventory, customerInfo, onOpenNewRental, onNavigate, onOpenChatbot, onCustomerBook }) {
  const todayStats = useTodayTasks(role);
  const kpis = useKpis(role);

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
    const recommended = (prefs.length > 0 && preferred.length > 0 ? preferred : available).slice(0, 4);
    const myRentals = (transactions || [])
      .filter((tx) => tx.status === 'Active' || tx.status === 'Overdue' || tx.status === 'Reserved')
      .slice(0, 3);
    const onSale = available
      .filter((i) => getSaleInfo(i).active)
      .slice(0, 4);
    const itemName = (tx) => (typeof tx.item === 'string' ? tx.item : tx.item?.name) || 'Item';

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

        {/* Recommended for You — personalized */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Recommended for You</h3>
              <p className="text-xs text-gray-500">{prefs.length > 0 ? 'Based on your interests' : 'Popular picks'}</p>
            </div>
            <button onClick={() => onNavigate('Catalog')} className="text-sm font-semibold text-gray-500 hover:text-[#bf4a53] transition-colors">View All</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {recommended.map((item) => (
              <ItemCard key={item.id} item={item} role={role} onBook={() => onCustomerBook(item)} />
            ))}
          </div>
        </div>

        {/* On Sale collection */}
        {onSale.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <span className="bg-[#bf4a53]/10 text-[#bf4a53] px-2 py-0.5 rounded-md text-xs">SALE</span>
                  On Sale
                </h3>
                <p className="text-xs text-gray-500">Limited-time discounts</p>
              </div>
              <button onClick={() => onNavigate('Catalog')} className="text-sm font-semibold text-gray-500 hover:text-[#bf4a53] transition-colors">View All</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              {onSale.map((item) => (
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
      </div>
    );
  }

  // Computed data (FIX G: prefer server-authoritative /dashboard/today when loaded)
  const today = new Date();
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);

  // Today's due returns (FIX G: from server when available)
  const todayStr = today.toISOString().split('T')[0];
  const upcomingToday = todayStats
    ? todayStats.dueToday.slice(0, 3)
    : transactions.filter(tx =>
        tx.status === 'Active' && tx.dueDate && tx.dueDate.split('T')[0] <= todayStr
      ).slice(0, 3);

  // Revenue is rentalFee (transactions have no `amount` field).
  const revenueToday = transactions
    .filter(tx => tx.date && new Date(tx.date).toDateString() === today.toDateString())
    .reduce((sum, tx) => sum + (tx.rentalFee || 0), 0);

  // Staff dashboard
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
      <div className="max-w-lg mx-auto md:max-w-3xl lg:max-w-[1200px]">
        {/* Header (mobile/tablet) — unchanged */}
        <div className="flex items-center justify-between mb-5 md:mb-6 lg:hidden">
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Staff Dashboard</h2>
            <p className="text-sm text-gray-500 mt-0.5">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>

        {/* Desktop header band */}
        <header className="hidden lg:flex items-center justify-between mb-7 pb-5 border-b border-gray-200/80">
          <div>
            <h2 className="text-[28px] leading-tight font-bold text-gray-900 tracking-tight">Staff Dashboard</h2>
            <p className="text-sm text-gray-500 mt-1">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <div className="flex items-center gap-2.5 bg-white border border-gray-200/80 rounded-full pl-3 pr-4 py-1.5 shadow-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-gray-600 tracking-wide">All systems normal</span>
          </div>
        </header>

        {/* Desktop bento grid — mobile/tablet/iPad get more vertical breathing room */}
        <div className="space-y-5 md:space-y-7 pt-2 lg:pt-0 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start">

        {/* KPI row — 2x2 on mobile, 4 across on tablet/desktop */}
        <div className="lg:col-span-12 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 lg:gap-5">
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
        <aside className="lg:col-span-3 lg:col-start-10 lg:row-start-2 lg:row-span-3 lg:self-start space-y-4 md:space-y-6 lg:space-y-6">

          {/* Quick Actions panel */}
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 flex flex-col gap-3 lg:gap-4">
            <p className="hidden lg:block text-[11px] font-bold text-gray-400 uppercase tracking-widest -mb-1">Quick Actions</p>
            {/* Primary CTA */}
            <button data-tour="new-rental" onClick={onOpenNewRental}
              className="w-full flex items-center justify-center gap-3 bg-[#bf4a53] text-white font-bold text-base lg:text-[15px] py-5 lg:py-3.5 rounded-2xl lg:rounded-xl shadow-lg shadow-red-500/20 hover:bg-red-700 btn-press transition-all min-h-[56px] lg:min-h-0">
              <Plus size={22} strokeWidth={3} />
              New Rental
            </button>
            {/* Secondary CTA */}
            <button data-tour="returns" onClick={() => onNavigate('History')}
              className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 lg:border-gray-200 text-gray-900 font-bold text-base lg:text-[15px] py-4 lg:py-3.5 rounded-2xl lg:rounded-xl hover:bg-gray-50 btn-press transition-all min-h-[56px] lg:min-h-0 shadow-sm lg:shadow-none">
              <Undo2 size={20} />
              Process Return
            </button>
          </div>

          {/* Today at a Glance (desktop only) */}
          <div className="hidden lg:block bg-white rounded-2xl border border-gray-100/80 shadow-sm p-5">
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
                <button onClick={() => onNavigate('Tasks')} className="text-xs font-semibold text-[#bf4a53] hover:underline">View All</button>
              </div>
              <div className="space-y-2.5">
                {overdueTxs.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between gap-2">
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
        <div className="lg:col-span-9 lg:col-start-1 bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 lg:p-6">
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
          <div className="lg:col-span-9 lg:col-start-1 bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 lg:p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Active Rentals</h3>
              <button onClick={() => onNavigate('History')}
                className="text-xs font-semibold text-[#bf4a53] hover:underline">
                View All
              </button>
            </div>
            <div className="space-y-3">
              {recentRentals.map(tx => (
                <div key={tx.id} className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
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
            <div className="lg:col-span-9 lg:col-start-1 bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 lg:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Needs Attention</h3>
                <button onClick={() => onNavigate('Catalog')} className="text-xs font-semibold text-[#bf4a53] hover:underline">
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
                    <button onClick={() => onNavigate('Catalog')} className="shrink-0 text-xs font-bold bg-white border border-gray-200 text-gray-900 px-3 py-1.5 rounded-full hover:bg-gray-100 transition-colors shadow-sm">
                      Fix
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Cleaning reminder — full queue lives in Tasks */}
        {cleaningCount > 0 && (
          <div className="lg:col-span-9 lg:col-start-1 bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Droplets size={16} className="text-orange-500 shrink-0" />
              <p className="text-sm font-semibold text-gray-800 truncate">
                {cleaningCount} item{cleaningCount === 1 ? '' : 's'} awaiting cleaning
              </p>
            </div>
            <button onClick={() => onNavigate('Tasks')}
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
  // Business KPIs come from the server (/dashboard/today + /dashboard/kpis) with
  // client-side fallbacks; the layout reuses the staff dashboard's visual language.
  const overdueCount = todayStats ? todayStats.overdue.length : transactions.filter(tx =>
    tx.status === 'Overdue' || (tx.status === 'Active' && new Date(tx.dueDate || tx.date) < dayStart)
  ).length;
  const availableCount = inventory.filter(i => i.status === 'Available').length;
  const cleaningCount = todayStats ? todayStats.inCleaning : inventory.filter(i => i.status === 'Cleaning').length;
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

  const revByMonth = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const label = d.toLocaleString('en-US', { month: 'short' });
    const txs = transactions.filter(tx => {
      const txd = new Date(tx.date);
      return txd.getFullYear() === d.getFullYear() && txd.getMonth() === d.getMonth();
    });
    revByMonth.push({ label, revenue: txs.reduce((s, tx) => s + (tx.rentalFee || 0), 0) });
  }
  const maxRevenue = Math.max(...revByMonth.map(m => m.revenue), 1);

  const itemCounts = {};
  transactions.forEach(tx => {
    const n = itemName(tx);
    if (n !== 'Item') itemCounts[n] = (itemCounts[n] || 0) + 1;
  });
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxTop = topItems.length > 0 ? topItems[0][1] : 1;

  return (
    <div className="max-w-lg mx-auto md:max-w-3xl lg:max-w-[1200px]">
      {/* Header (mobile/tablet) */}
      <div className="flex items-center justify-between mb-5 md:mb-6 lg:hidden">
        <div>
          <h2 className="text-xl font-bold text-gray-900 tracking-tight">Admin Dashboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      {/* Desktop header band */}
      <header className="hidden lg:flex items-center justify-between mb-7 pb-5 border-b border-gray-200/80">
        <div>
          <h2 className="text-[28px] leading-tight font-bold text-gray-900 tracking-tight">Admin Dashboard</h2>
          <p className="text-sm text-gray-500 mt-1">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <div className="flex items-center gap-2.5 bg-white border border-gray-200/80 rounded-full pl-3 pr-4 py-1.5 shadow-sm">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-gray-600 tracking-wide">All systems normal</span>
        </div>
      </header>

      <div className="space-y-5 md:space-y-7 pt-2 lg:pt-0 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start">

        {/* KPI row — 2x2 on mobile, 4 across on tablet/desktop */}
        <div className="lg:col-span-12 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 lg:gap-5">
          <button onClick={() => onNavigate('AI Insights')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Monthly Revenue</p>
            <p className="text-2xl lg:text-3xl font-extrabold text-gray-900 mt-1">₱{monthlyRevenue.toLocaleString()}</p>
            <p className={`text-[10px] font-bold mt-0.5 ${revDiff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {revDiff >= 0 ? '+' : '-'}₱{Math.abs(revDiff).toLocaleString()} vs last month
            </p>
          </button>
          <button onClick={() => onNavigate('History')}
            className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-100/80 shadow-sm text-center lg:text-left hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Active Rentals</p>
            <p className={`text-2xl lg:text-3xl font-extrabold mt-1 ${overdueReturns > 0 ? 'text-red-500' : 'text-gray-900'}`}>{activeRentals}</p>
            <p className="text-[10px] font-bold mt-0.5 text-gray-400">{overdueReturns > 0 ? `${overdueReturns} overdue` : 'all on time'}</p>
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
        <div className="lg:col-span-9 space-y-4 md:space-y-6 lg:space-y-6">
          {/* Revenue Trend (6 months) */}
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 lg:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Revenue Trend</h3>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">₱{revenueToday.toLocaleString()} collected today</span>
            </div>
            <div className="h-36 flex items-end justify-between gap-2">
              {revByMonth.map((m) => (
                <div key={m.label} className="flex-1 flex flex-col items-center justify-end h-full group">
                  <span className="text-[10px] text-gray-500 font-semibold mb-1 opacity-0 group-hover:opacity-100 transition-opacity">₱{m.revenue.toLocaleString()}</span>
                  <div className="w-full bg-[#bf4a53]/15 rounded-t-lg transition-all duration-500 group-hover:bg-[#bf4a53]/30 cursor-pointer"
                    style={{ height: `${(m.revenue / maxRevenue) * 100}%`, minHeight: m.revenue > 0 ? '4px' : '0' }} />
                  <span className="text-[9px] text-gray-400 font-semibold mt-1.5">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Rented Items */}
          <div className="bg-white rounded-2xl border border-gray-100/80 shadow-sm p-4 sm:p-5 lg:p-6">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Top Rented Items</h3>
            {topItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6 font-medium">No rental data yet.</p>
            ) : (
              <div className="space-y-3.5">
                {topItems.map(([name, count], i) => (
                  <div key={name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700 truncate flex-1">{i + 1}. {name}</span>
                      <span className="font-bold text-gray-900 ml-2">{count}x</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-[#bf4a53]" style={{ width: `${Math.min((count / maxTop) * 100, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Overdue Follow-ups */}
          {overdueCount > 0 && (
            <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-4 sm:p-5 lg:p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Overdue Follow-ups</h3>
                <button onClick={() => onNavigate('Tasks')} className="text-xs font-semibold text-[#bf4a53] hover:underline">View All</button>
              </div>
              <div className="space-y-2.5">
                {overdueTxs.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between gap-2 py-1">
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
        </div>

        {/* Right rail — Business Health + Inventory Health + AI Insights */}
        <aside className="lg:col-span-3 lg:self-start space-y-4 md:space-y-6 lg:space-y-6">

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
              <button onClick={() => onNavigate('Catalog')} className="text-xs font-semibold text-[#bf4a53] hover:underline">Manage</button>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 font-medium">Available</span>
                <span className="font-bold text-emerald-600">{availableItems} of {totalItems}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 font-medium">In cleaning</span>
                <span className={`font-bold ${cleaningCount > 0 ? 'text-orange-500' : 'text-gray-900'}`}>{cleaningCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 font-medium">Out of service</span>
                <span className={`font-bold ${damagedItems > 0 ? 'text-red-500' : 'text-gray-900'}`}>{damagedItems}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 font-medium">On sale</span>
                <span className="font-bold text-[#bf4a53]">{onSaleCount}</span>
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
                {overdueCount > 0 ? 'Action needed — review Tasks for details.' : 'All returns are on track.'}
              </p>
            </div>
            <button onClick={() => onNavigate('AI Insights')}
              className="w-full mt-4 bg-white border border-gray-200 text-gray-800 font-semibold text-sm py-2.5 rounded-full hover:bg-gray-50 transition-colors shadow-sm">
              Full Report
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}