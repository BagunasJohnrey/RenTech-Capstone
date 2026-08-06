import { Search } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileBottomNav from './MobileBottomNav';
import NotificationsDropdown from '../components/NotificationsDropdown';

// Layout-level CSS (animations, scrollbars). Kept here so the composition
// root (App.jsx) stays free of styling concerns.
const customStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

  body { font-family: 'Plus Jakarta Sans', sans-serif; }
  .custom-scrollbar::-webkit-scrollbar { width: 4px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #f3f4f6; border-radius: 20px; }
  .custom-scrollbar:hover::-webkit-scrollbar-thumb { background-color: #e5e7eb; }
  .hide-scrollbar::-webkit-scrollbar { display: none; }
  .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

  /* Transition animations */
  .page-enter { animation: fadeSlideUp 0.4s ease-out; }
  .modal-enter { animation: modalIn 0.3s ease-out; }
  .modal-exit { animation: modalOut 0.2s ease-in; }
  .toast-enter { animation: toastIn 0.3s ease-out; }
  .btn-press:active { transform: scale(0.97); }
  .step-enter { animation: slideInRight 0.3s ease-out; }
  .step-exit { animation: slideOutLeft 0.2s ease-in; }
  .shimmer { background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }

  @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes modalIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
  @keyframes modalOut { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.95); } }
  @keyframes toastIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes slideInRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes slideOutLeft { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-20px); } }
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

  /* Staggered list animation */
  .stagger > * { opacity: 0; animation: fadeSlideUp 0.3s ease-out forwards; }
  .stagger > *:nth-child(1) { animation-delay: 0.05s; }
  .stagger > *:nth-child(2) { animation-delay: 0.1s; }
  .stagger > *:nth-child(3) { animation-delay: 0.15s; }
  .stagger > *:nth-child(4) { animation-delay: 0.2s; }
  .stagger > *:nth-child(5) { animation-delay: 0.25s; }
`;

// Persistent application shell: sidebar + top bar + main content area +
// mobile bottom nav. The active page is passed as `children`; transient
// modals/overlays are passed as `overlays`. All dynamic behavior is supplied
// by the composition root (App.jsx) via props — this component only renders.
export default function AppLayout({
  viewRole,
  activeTab,
  setActiveTab,
  navItems,
  onRequestLogout,
  customerInfo,
  role,
  onOpenGlobalSearch,
  onAddItem,
  onOpenSettings,
  onOpenHelp,
  showNotifications,
  onToggleNotifications,
  onViewAllNotifications,
  taskBadge,
  onFabClick,
  children,
  overlays,
}) {
  return (
    <>
      <style>{customStyles}</style>
      <div className="w-full h-screen bg-[#fcfcfd] flex flex-col md:flex-row overflow-hidden relative text-gray-800">

        <Sidebar
          role={viewRole}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          navItems={navItems}
          onRequestLogout={onRequestLogout}
          customerName={customerInfo.name}
          taskBadge={taskBadge}
        />

        <main className="grow flex flex-col h-screen overflow-hidden relative pb-24 md:pb-0">
          <header className="bg-white/70 backdrop-blur-xl border-b border-gray-100/50 px-5 md:px-10 py-4 flex items-center justify-between z-20 shrink-0">
            <div className="flex items-center gap-2 md:hidden">
              <img
                src="/RenTech.png"
                alt="Profile"
                className="w-8 h-8 rounded-full object-cover border border-gray-200"
              />
              {/* Mobile role / name display */}
              <span className="text-sm font-bold text-gray-800 truncate max-w-[120px]">
                {viewRole === 'Customer' ? (customerInfo?.name || 'Customer') : viewRole}
              </span>
            </div>

            <div className="hidden md:block">
              <h2 className="text-sm font-bold text-gray-800">{viewRole} Portal</h2>
            </div>

            {/* Right side actions */}
            <div className="flex items-center gap-2">
              {/* Global search – Staff & Admin */}
              {(viewRole === 'Staff' || viewRole === 'Admin') && (
                <button
                  onClick={onOpenGlobalSearch}
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                  title="Search (Ctrl+K)"
                >
                  <Search size={18} />
                </button>
              )}

              {/* + Add Item – Staff only */}
              {viewRole === 'Staff' && (
                <button
                  onClick={onAddItem}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-gray-200 text-gray-700 rounded-full hover:bg-gray-50 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Item
                </button>
              )}

              {/* Settings – Staff mobile */}
              {viewRole === 'Staff' && (
                <button
                  onClick={onOpenSettings}
                  className="md:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                  title="Settings"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              )}

              {/* Help Guide – Customer only (Staff/Admin access via Settings) */}
              {viewRole === 'Customer' && (
                <button
                  onClick={onOpenHelp}
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                  title="Help Guide"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </button>
              )}

              <NotificationsDropdown
                role={role}
                showNotifications={showNotifications}
                toggle={onToggleNotifications}
                onViewAll={onViewAllNotifications}
              />
            </div>
          </header>

          <div className="p-5 md:p-10 max-w-7xl mx-auto w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {children}
          </div>
        </main>

        <MobileBottomNav
          role={viewRole}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          currentNav={navItems}
          onFabClick={onFabClick}
          taskBadge={taskBadge}
        />

        {overlays}
      </div>
    </>
  );
}
