import { HelpCircle, LogOut } from 'lucide-react';

export default function Sidebar({ role, activeTab, setActiveTab, navItems, onRequestLogout, customerName, taskBadge = 0 }) {
  const displayName = role === 'Customer' ? (customerName || 'Customer') : role;
  const mainNav = navItems.filter(i => i.id !== 'Help');
  const isActiveFn = (id) => activeTab === id || (id === 'Home' && activeTab === 'Dashboard');

  return (
    <aside className="hidden md:flex flex-col w-64 bg-white/80 backdrop-blur-xl border-r border-gray-100/50 sticky top-0 h-screen z-20">
      {/* Logo + role */}
      <div className="p-8 flex items-center gap-3 border-b border-gray-100/50">
        <img src="/RenTech.png" alt="" className="w-10 h-10 rounded-full object-cover border-2 border-gray-200 shrink-0" />
        <div className="min-w-0">
          <h1 className="font-bold text-sm tracking-tight text-gray-900 truncate">{displayName}</h1>
          <p className="text-[10px] text-gray-500">{role}</p>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto hide-scrollbar mt-4">
        {mainNav.map((item) => {
          const Icon = item.icon;
          const isActive = isActiveFn(item.id);
          return (
            <button key={item.id} data-tab={item.id}
              onClick={() => setActiveTab(item.id === 'Home' ? 'Dashboard' : item.id)}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-[13px] font-semibold transition-all duration-300 ${
                isActive ? 'bg-red-50/80 text-[#bf4a53]' : 'text-gray-500 hover:bg-gray-50/80 hover:text-gray-900'
              }`}>
              <Icon size={18} className={isActive ? 'text-[#bf4a53]' : 'text-gray-400'} strokeWidth={isActive ? 2.5 : 2} />
              {item.label}
              {item.id === 'Tasks' && taskBadge > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold min-w-[20px] h-5 flex items-center justify-center rounded-full px-1.5 shadow-sm shadow-red-500/30">
                  {taskBadge}
                </span>
              )}
              {item.special && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#bf4a53] animate-pulse shadow-[0_0_8px_rgba(191,74,83,0.8)]" />}
            </button>
          );
        })}
      </nav>

      {/* Bottom actions: Help + Sign Out */}
      <div className="p-6 space-y-3 border-t border-gray-100/50">
        <button data-tab="Help"
          onClick={() => setActiveTab('Help')}
          className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-[13px] font-semibold transition-all duration-300 ${
            activeTab === 'Help' ? 'bg-red-50/80 text-[#bf4a53]' : 'text-gray-500 hover:bg-gray-50/80 hover:text-gray-900'
          }`}>
          <HelpCircle size={18} className={activeTab === 'Help' ? 'text-[#bf4a53]' : 'text-gray-400'} strokeWidth={activeTab === 'Help' ? 2.5 : 2} />
          Help Guide
        </button>
        <button onClick={onRequestLogout}
          className="w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-[13px] font-semibold text-gray-500 hover:bg-red-50/50 hover:text-[#bf4a53] transition-colors">
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}