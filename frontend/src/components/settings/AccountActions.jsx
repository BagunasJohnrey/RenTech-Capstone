import { LogOut } from 'lucide-react';

// Sign-out card rendered at the bottom of every Profile/Settings screen.
export default function AccountActions({ onRequestLogout }) {
  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h3 className="font-bold text-gray-900">Account Actions</h3>
        <p className="text-sm text-gray-500 mt-1">Sign out of your account and return to the landing page.</p>
      </div>
      <button
        onClick={onRequestLogout}
        className="flex items-center gap-2 px-5 py-2.5 border border-red-200 bg-red-50 text-[#bf4a53] font-bold text-sm rounded-full hover:bg-red-100 transition-colors shrink-0"
      >
        <LogOut size={16} />
        Sign Out
      </button>
    </div>
  );
}