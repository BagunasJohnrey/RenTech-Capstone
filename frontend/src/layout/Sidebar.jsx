import { useState } from 'react';
import { HelpCircle, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

// Desktop sidebar collapse preference (persisted; mobile is unaffected — the
// sidebar is hidden below md and replaced by the bottom nav).
const COLLAPSED_KEY = 'rentech_sidebar_collapsed';

export default function Sidebar({ role, activeTab, setActiveTab, navItems, onRequestLogout, customerName, taskBadge = 0 }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const displayName = role === 'Customer' ? (customerName || 'Customer') : role;
  const mainNav = navItems.filter(i => i.id !== 'Help');
  const isActiveFn = (id) => activeTab === id || (id === 'Home' && activeTab === 'Dashboard');

  return (
    <aside className={`hidden md:flex flex-col bg-white/80 backdrop-blur-xl border-r border-gray-100/50 sticky top-0 h-screen z-20 transition-all duration-300 ${collapsed ? 'w-20' : 'w-64'}`}>
      {/* Logo + role + collapse toggle */}
      <div className={`border-b border-gray-100/50 flex items-center gap-3 ${collapsed ? 'flex-col px-2 py-6 gap-2' : 'p-8'}`}>
        <img src="/RenTech.png" alt="" className="w-10 h-10 rounded-full object-cover border-2 border-gray-200 shrink-0" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-sm tracking-tight text-gray-900 leading-tight break-words">{displayName}</h1>
            <p className="text-[10px] text-gray-500">{role}</p>
          </div>
        )}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`${collapsed ? 'w-9 h-9' : 'w-8 h-8 shrink-0'} flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100/80 transition-colors`}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className={`flex-1 space-y-1.5 overflow-y-auto hide-scrollbar mt-4 ${collapsed ? 'px-2.5' : 'px-4'}`}>
        {mainNav.map((item) => {
          const Icon = item.icon;
          const isActive = isActiveFn(item.id);
          return (
            <button key={item.id} data-tab={item.id}
              onClick={() => setActiveTab(item.id === 'Home' ? 'Dashboard' : item.id)}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              className={`w-full flex items-center ${collapsed ? 'justify-center px-0 py-3.5' : 'gap-3.5 px-4 py-3'} rounded-2xl text-[13px] font-semibold transition-all duration-300 ${
                isActive ? 'bg-red-50/80 text-[#bf4a53]' : 'text-gray-500 hover:bg-gray-50/80 hover:text-gray-900'
              }`}>
              <span className="relative shrink-0">
                <Icon size={18} className={`${isActive ? 'text-[#bf4a53]' : 'text-gray-400'}`} strokeWidth={isActive ? 2.5 : 2} />
                {item.id === 'Tasks' && taskBadge > 0 && collapsed && (
                  <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1 shadow-sm shadow-red-500/30">
                    {taskBadge > 9 ? '9+' : taskBadge}
                  </span>
                )}
              </span>
              {!collapsed && (
                <>
                  <span className="truncate flex-1 text-left">{item.label}</span>
                  {item.id === 'Tasks' && taskBadge > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-[10px] font-bold min-w-[20px] h-5 flex items-center justify-center rounded-full px-1.5 shadow-sm shadow-red-500/30">
                      {taskBadge}
                    </span>
                  )}
                  {item.special && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#bf4a53] animate-pulse shadow-[0_0_8px_rgba(191,74,83,0.8)]" />}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom actions: Help is a Customer-only tab (admin/staff read it
          inside Settings), so don't render a sidebar entry for them. */}
      <div className={`space-y-3 border-t border-gray-100/50 ${collapsed ? 'px-2.5 py-6' : 'p-6'}`}>
        {role === 'Customer' && (
          <button data-tab="Help"
            onClick={() => setActiveTab('Help')}
            title={collapsed ? 'Help Guide' : undefined}
            aria-label="Help Guide"
            className={`w-full flex items-center ${collapsed ? 'justify-center px-0 py-3' : 'gap-3.5 px-4 py-3'} rounded-2xl text-[13px] font-semibold transition-all duration-300 ${
              activeTab === 'Help' ? 'bg-red-50/80 text-[#bf4a53]' : 'text-gray-500 hover:bg-gray-50/80 hover:text-gray-900'
            }`}>
            <HelpCircle size={18} className={`${activeTab === 'Help' ? 'text-[#bf4a53]' : 'text-gray-400'} shrink-0`} strokeWidth={activeTab === 'Help' ? 2.5 : 2} />
            {!collapsed && <span className="truncate flex-1 text-left">Help Guide</span>}
          </button>
        )}
        <button onClick={onRequestLogout}
          title={collapsed ? 'Sign Out' : undefined}
          aria-label="Sign Out"
          className={`w-full flex items-center ${collapsed ? 'justify-center px-0 py-3' : 'gap-3.5 px-4 py-3'} rounded-2xl text-[13px] font-semibold text-gray-500 hover:bg-red-50/50 hover:text-[#bf4a53] transition-colors`}>
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span className="truncate flex-1 text-left">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
