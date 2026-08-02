import { Sparkles, ShoppingBag, Clock, BarChart3, Activity, Plus, Undo2, AlertTriangle, Package, TrendingUp, ChevronRight, User } from 'lucide-react';
import ItemCard, { getSaleInfo } from '../components/ItemCard';
import StatCard from '../components/StatCard';
import CleaningQueue from '../components/CleaningQueue';
import { useTodayTasks } from '../hooks/useDashboard';

export default function DashboardView({ role, transactions, inventory, customerInfo, onOpenNewRental, onNavigate, onOpenChatbot, onCustomerBook, onMarkClean }) {
  const todayStats = useTodayTasks(role);

  // Normalize customer/item to a display name — client transactions carry a
  // string, while server /dashboard/today returns { id, name, phone } objects.
  const custName = (tx) => (typeof tx.customer === 'string' ? tx.customer : tx.customer?.name) || 'Customer';
  const itemName = (tx) => (typeof tx.item === 'string' ? tx.item : tx.item?.name) || 'Item';
  const cleaningItems = inventory.filter((i) => i.status === 'Cleaning');
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
                  <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded-md text-xs">SALE</span>
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
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tx.status === 'Overdue' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>{tx.status}</span>
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
  const activeRentalsCount = transactions.filter(tx => tx.status === 'Active').length;
  // Monthly revenue (current month)
  const monthlyRevenue = transactions
    .filter(tx => { const d = new Date(tx.date); return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth(); })
    .reduce((sum, tx) => sum + tx.amount, 0);

  const damagedCount = inventory.filter(i => i.status === 'Damaged').length;

  // Today's due returns (FIX G: from server when available)
  const todayStr = today.toISOString().split('T')[0];
  const upcomingToday = todayStats
    ? todayStats.dueToday.slice(0, 5)
    : transactions.filter(tx =>
        tx.status === 'Active' && tx.dueDate && tx.dueDate.split('T')[0] <= todayStr
      ).slice(0, 5);

  // Demand Forecast
  const getMonthData = (month, year) => {
    const txs = transactions.filter(tx => { const d = new Date(tx.date); return d.getFullYear() === year && d.getMonth() === month; });
    return { count: txs.length, revenue: txs.reduce((s, tx) => s + tx.amount, 0) };
  };
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    const data = getMonthData(d.getMonth(), d.getFullYear());
    months.push({ label, count: data.count, revenue: data.revenue });
  }
  // Staff dashboard
  if (role === 'Staff') {
    const overdueCount = todayStats ? todayStats.overdue.length : transactions.filter(tx => tx.status === 'Overdue').length;
    const availableCount = inventory.filter(i => i.status === 'Available').length;
    const cleaningCount = todayStats ? todayStats.inCleaning : inventory.filter(i => i.status === 'Cleaning').length;
    const maintenanceCount = inventory.filter(i => i.status === 'Maintenance').length;
    const recentRentals = transactions.filter(tx => tx.status === 'Active' || tx.status === 'Overdue').slice(0, 5);
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Staff Dashboard</h2>
            <p className="text-sm text-gray-500 mt-0.5">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3">
          <button onClick={() => onNavigate('History')}
            className="bg-white rounded-2xl p-4 border border-gray-100/80 shadow-sm text-center hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500">Active</p>
            <p className="text-2xl font-extrabold text-gray-900 mt-1">{activeRentalsCount}</p>
          </button>
          <button onClick={() => onNavigate('Tasks')}
            className="bg-white rounded-2xl p-4 border border-gray-100/80 shadow-sm text-center hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500">
              {overdueCount > 0 ? <span className="text-red-500">Overdue</span> : 'Overdue'}
            </p>
            <p className={`text-2xl font-extrabold mt-1 ${overdueCount > 0 ? 'text-red-500' : 'text-gray-900'}`}>{overdueCount}</p>
          </button>
          <button onClick={() => onNavigate('Catalog')}
            className="bg-white rounded-2xl p-4 border border-gray-100/80 shadow-sm text-center hover:shadow-md hover:border-gray-200 transition-all btn-press">
            <p className="text-[11px] font-semibold text-gray-500">Available</p>
            <p className="text-2xl font-extrabold text-gray-900 mt-1">{availableCount}</p>
          </button>
        </div>

        {/* Overdue alert */}
        {overdueCount > 0 && (
          <div className="bg-red-50 border border-red-200/70 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm font-semibold text-red-700">
              {overdueCount} rental{overdueCount > 1 ? 's' : ''} past due. <button onClick={() => onNavigate('Tasks')} className="underline">View</button>
            </p>
          </div>
        )}

        {/* Primary CTA */}
        <button data-tour="new-rental" onClick={onOpenNewRental}
          className="w-full flex items-center justify-center gap-3 bg-[#bf4a53] text-white font-bold text-base py-5 rounded-2xl shadow-lg shadow-red-500/20 hover:bg-red-700 btn-press transition-all min-h-[56px]">
          <Plus size={22} strokeWidth={3} />
          New Rental
        </button>

        {/* Secondary CTA */}
        <button data-tour="returns" onClick={() => onNavigate('History')}
          className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 text-gray-900 font-bold text-base py-4 rounded-2xl hover:bg-gray-50 btn-press transition-all min-h-[56px] shadow-sm">
          <Undo2 size={20} />
          Process Return
        </button>

        {/* Upcoming Today */}
        <div>
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
            <div className="bg-white rounded-2xl p-6 border border-gray-100/80 shadow-sm text-center">
              <p className="text-sm text-gray-400 font-medium">No returns due today.</p>
            </div>
          ) : (
            <div className="space-y-3 stagger">
              {upcomingToday.map(tx => (
                <div key={tx.id} className="bg-white rounded-2xl p-4 border border-gray-100/80 shadow-sm flex items-center gap-3">
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

        {/* Recent Rentals */}
        {recentRentals.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Active Rentals</h3>
              <button onClick={() => onNavigate('History')}
                className="text-xs font-semibold text-[#bf4a53] hover:underline">
                View All
              </button>
            </div>
            <div className="space-y-3">
              {recentRentals.map(tx => (
                <div key={tx.id} className="bg-white rounded-2xl p-4 border border-gray-100/80 shadow-sm flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                    <ShoppingBag size={16} className="text-[#bf4a53]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{custName(tx)}</p>
                    <p className="text-xs text-gray-500 truncate">{itemName(tx)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tx.status === 'Overdue' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inventory Health */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100/80 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Inventory Health</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-lg font-extrabold text-gray-900">{availableCount}</p>
              <p className="text-[11px] font-semibold text-gray-500">Available</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-lg font-extrabold text-gray-900">{cleaningCount}</p>
              <p className="text-[11px] font-semibold text-gray-500">In Cleaning</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-lg font-extrabold text-amber-600">{maintenanceCount}</p>
              <p className="text-[11px] font-semibold text-gray-500">Maintenance</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-lg font-extrabold text-red-500">{damagedCount}</p>
              <p className="text-[11px] font-semibold text-gray-500">Damaged</p>
            </div>
          </div>
        </div>
      {cleaningItems.length > 0 && (
        <CleaningQueue items={cleaningItems} onMarkClean={onMarkClean} onViewAll={() => onNavigate('Catalog')} />
      )}
      </div>
    );
  }

  // ---------- Admin dashboard ----------
  // Enhanced computed data
  const overdueCount = transactions.filter(tx => tx.status === 'Overdue').length;
  const availableItems = inventory.filter(i => i.status === 'Available').length;
  const cleaningCount = inventory.filter(i => i.status === 'Cleaning').length;
  const totalItems = inventory.length;

  // Revenue by month
  const revByMonth = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const label = d.toLocaleString('en-US', { month: 'short' });
    const txs = transactions.filter(tx => {
      const txd = new Date(tx.date);
      return txd.getFullYear() === d.getFullYear() && txd.getMonth() === d.getMonth();
    });
    revByMonth.push({ label, revenue: txs.reduce((s, tx) => s + tx.amount, 0) });
  }
  const maxRevenue = Math.max(...revByMonth.map(m => m.revenue), 1);

  // Top items
  const itemRentalCounts = {};
  transactions.forEach(tx => {
    if (tx.item) itemRentalCounts[tx.item] = (itemRentalCounts[tx.item] || 0) + 1;
  });
  const topItems = Object.entries(itemRentalCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Overdue transactions for alerts
  const overdueTxs = transactions.filter(tx => tx.status === 'Overdue').slice(0, 3);

  // Today's due (Active with dueDate <= today)
  const dueToday = transactions.filter(tx =>
    tx.status === 'Active' && tx.dueDate && new Date(tx.dueDate) <= today
  ).slice(0, 4);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Dashboard</h2>
          <p className="text-gray-500 font-medium mt-1">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>

      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Active Rentals" value={activeRentalsCount.toString()} trend={activeRentalsCount > 0 ? `${activeRentalsCount} ongoing` : 'None'} icon={ShoppingBag} onClick={() => onNavigate('History')} />
        <StatCard title="Overdue Returns" value={overdueCount.toString()} trend={overdueCount > 0 ? `${overdueCount} need attention` : 'All clear'} icon={Clock} isWarning={overdueCount > 0} onClick={() => onNavigate('Tasks')} />
        <StatCard title="Monthly Revenue" value={`₱${monthlyRevenue.toLocaleString()}`} trend={revByMonth.length >= 2 ? `${revByMonth[revByMonth.length - 1].revenue > revByMonth[revByMonth.length - 2].revenue ? '+' : ''}${revByMonth[revByMonth.length - 1].revenue - revByMonth[revByMonth.length - 2].revenue} vs last mo` : 'This month'} icon={BarChart3} onClick={() => onNavigate('AI Insights')} />
        <StatCard title="Available Items" value={`${availableItems}`} trend={`${totalItems > 0 ? Math.round((availableItems / totalItems) * 100) : 0}% of ${totalItems}`} icon={Activity} isAlert={availableItems < 5} onClick={() => onNavigate('Catalog')} />
      </div>



      {/* Overdue Alert */}
      {overdueCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <Clock size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-red-800 text-sm">{overdueCount} overdue rental{overdueCount > 1 ? 's' : ''} need{overdueCount === 1 ? 's' : ''} immediate attention</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {overdueTxs.map(tx => (
                <span key={tx.id} className="text-xs bg-white px-2.5 py-1 rounded-full border border-red-200 text-red-700 font-medium">
                  {custName(tx)} — {itemName(tx)}
                </span>
              ))}
              {overdueCount > 3 && <span className="text-xs text-red-500 font-medium px-2 py-1">+{overdueCount - 3} more</span>}
            </div>
          </div>
          <button onClick={() => onNavigate('Tasks')} className="text-xs font-bold text-red-600 hover:underline shrink-0">View</button>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Upcoming Due + Revenue Mini Chart */}
        <div className="lg:col-span-2 space-y-6">
          {/* Revenue Mini Chart */}
          <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 text-base">Revenue Trend</h3>
              <button onClick={() => onNavigate('AI Insights')} className="text-xs font-bold text-[#bf4a53] hover:underline">View Details</button>
            </div>
            <div className="h-28 flex items-end justify-between gap-2">
              {revByMonth.map((m) => (
                <div key={m.label} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div className="w-full bg-gray-900 rounded-t-lg transition-all duration-500 hover:bg-gray-700 cursor-pointer" style={{ height: `${(m.revenue / maxRevenue) * 100}%`, minHeight: m.revenue > 0 ? '4px' : '0' }} />
                  <span className="text-[9px] text-gray-400 font-semibold mt-1.5">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Due Today / Overdue List */}
          <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 text-base">Due Today</h3>
              {dueToday.length > 0 && <button onClick={() => onNavigate('Tasks')} className="text-xs font-bold text-[#bf4a53] hover:underline">View All</button>}
            </div>
            {dueToday.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6 font-medium">No items due today.</p>
            ) : (
              <div className="space-y-3">
                {dueToday.map(tx => {
                  const isOverdue = new Date(tx.dueDate) < today;
                  return (
                    <div key={tx.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isOverdue ? 'bg-red-100 text-red-500' : 'bg-orange-100 text-orange-500'}`}>
                        <User size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{custName(tx)}</p>
                        <p className="text-xs text-gray-500 truncate">{itemName(tx)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs font-bold ${isOverdue ? 'text-red-500' : 'text-orange-500'}`}>
                          {isOverdue ? 'Overdue' : new Date(tx.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: AI Insights */}
        <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm flex flex-col relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-32 h-32 bg-red-50/50 rounded-full blur-3xl pointer-events-none" />
          <div className="flex items-center gap-2.5 mb-5 relative z-10">
            <div className="p-2 bg-red-50 text-[#bf4a53] rounded-xl"><Sparkles size={18} /></div>
            <h3 className="font-bold text-gray-900 text-lg">AI Insights</h3>
          </div>
          <div className="flex-1 space-y-3 relative z-10">
            <div className="p-3.5 bg-gray-50/80 rounded-2xl border border-gray-100/50">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle size={15} className={overdueCount > 0 ? 'text-red-500' : 'text-emerald-500'} />
                <span className="font-bold text-gray-900 text-[13px]">{overdueCount > 0 ? `${overdueCount} Overdue` : 'All Clear'}</span>
              </div>
              <p className="text-[13px] text-gray-700 leading-relaxed">
                {overdueCount > 0
                  ? `${overdueCount} rental(s) past due — review Tasks for details.`
                  : 'No overdue rentals. All returns on track.'}
              </p>
            </div>
            <div className="p-3.5 bg-gray-50/80 rounded-2xl border border-gray-100/50">
              <div className="flex items-center gap-2 mb-1">
                <Package size={15} className="text-blue-500" />
                <span className="font-bold text-gray-900 text-[13px]">Inventory</span>
              </div>
              <p className="text-[13px] text-gray-700 leading-relaxed">
                {`${availableItems} of ${totalItems} items available (${cleaningCount} in cleaning, ${damagedCount} damaged).`}
              </p>
            </div>
            <div className="p-3.5 bg-gray-50/80 rounded-2xl border border-gray-100/50">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp size={15} className="text-[#bf4a53]" />
                <span className="font-bold text-gray-900 text-[13px]">Top Items</span>
              </div>
              <p className="text-[13px] text-gray-700 leading-relaxed">
                {topItems.length > 0
                  ? topItems.map(([name, count], i) => `${i + 1}. ${name} (${count}x)`).join(', ')
                  : 'No rental data yet.'}
              </p>
            </div>
          </div>
          <button onClick={() => onNavigate('AI Insights')}
            className="w-full mt-5 bg-white border border-gray-200 text-gray-800 font-semibold text-sm py-2.5 rounded-full hover:bg-gray-50 transition-colors relative z-10 shadow-sm">
            Full Report
          </button>
        </div>
      </div>
    </div>
  );
}

