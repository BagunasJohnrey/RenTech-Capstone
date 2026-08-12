import { Plus, Sparkles } from 'lucide-react';

function BottomNavItem({ item, isActive, onClick, badge }) {
  const Icon = item.icon;
  return (
    <button data-tab={item.id} onClick={onClick}
      className={`flex flex-col items-center justify-center min-w-0 flex-1 gap-1.5 transition-all duration-300 relative ${isActive ? 'text-[#bf4a53]' : 'text-gray-400'}`}>
      <div className={`p-1.5 rounded-full transition-colors ${isActive ? 'bg-red-50/80' : 'bg-transparent'}`}>
        <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
      </div>
      {badge > 0 && (
        <span className="absolute top-0 right-1/2 -translate-y-1 translate-x-4 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1 shadow-sm shadow-red-500/30">
          {badge}
        </span>
      )}
      <span className="text-[10px] font-semibold tracking-wide">{item.label.split(' ')[0]}</span>
    </button>
  );
}

export default function MobileBottomNav({ role, activeTab, setActiveTab, currentNav, onFabClick, taskBadge = 0 }) {
  const fabIcon = role === 'Admin' ? <Sparkles size={22} strokeWidth={2.5} /> : <Plus size={24} strokeWidth={2.5} />;
  const isActive = (id) => activeTab === id || (id === 'Home' && activeTab === 'Dashboard');
  const mainItems = currentNav.filter(i => i.id !== 'Help' && !(role === 'Staff' && i.id === 'Settings'));
  const specialItem = mainItems.find(i => i.special);
  const regularItems = mainItems.filter(i => !i.special);

  // Show 2 left + 3 right regular tabs around the FAB
  const leftItems = regularItems.slice(0, 2);
  const rightItems = regularItems.slice(2, 5);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white/90 backdrop-blur-xl border-t border-gray-100/50 flex justify-around items-end pb-6 pt-3 px-2 z-40 h-20.5 shadow-[0_-10px_40px_rgba(0,0,0,0.04)]">
      {leftItems.map((item) => (
        <BottomNavItem key={item.id} item={item}
          isActive={isActive(item.id)}
          onClick={() => setActiveTab(item.id === 'Home' ? 'Dashboard' : item.id)}
          badge={item.id === 'Tasks' ? taskBadge : 0} />
      ))}

      <button onClick={onFabClick}
        className={`relative -top-6 w-14 h-14 rounded-full flex items-center justify-center shadow-xl shadow-red-500/30 text-white transform transition-transform active:scale-95 z-50 border-4 border-[#fcfcfd] ${
          activeTab === (specialItem?.id || '') ? 'bg-[#bf4a53]' : 'bg-gradient-to-br from-[#bf4a53] to-red-600'
        }`}>
        {fabIcon}
      </button>

      {rightItems.map((item) => (
        <BottomNavItem key={item.id} item={item}
          isActive={isActive(item.id)}
          onClick={() => setActiveTab(item.id)}
          badge={item.id === 'Tasks' ? taskBadge : 0} />
      ))}
    </nav>
  );
}
