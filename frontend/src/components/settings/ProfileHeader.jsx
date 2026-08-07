import { useState } from 'react';
import { User } from 'lucide-react';
import { ITEM_TYPES } from './constants';

// Top profile card: avatar, name/role, and (for customers) the editable
// contact + interest-preference block.
export default function ProfileHeader({ role, profile, customerInfo, onUpdateCustomer }) {
  const [editCustomer, setEditCustomer] = useState(false);
  const [localCustomer, setLocalCustomer] = useState(customerInfo || { name: '', contact: '', address: '', preferences: [], styleNotes: '' });
  const [saveMessage, setSaveMessage] = useState('');

  const handleSaveCustomer = () => {
    onUpdateCustomer(localCustomer);
    setEditCustomer(false);
    setSaveMessage('Profile updated!');
    setTimeout(() => setSaveMessage(''), 2000);
  };

  const inputClass = 'w-full p-2.5 bg-gray-50 rounded-xl border text-sm focus:outline-none focus:border-[#bf4a53]';

  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 flex flex-col md:flex-row gap-5 md:gap-8 items-start">
      <div className="w-16 h-16 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 border-4 border-white shadow-lg flex items-center justify-center shrink-0 text-gray-400">
        <User size={28} className="md:size-10" />
      </div>
      <div className="flex-1 space-y-3 w-full">
        <div>
          <h3 className="text-xl font-bold text-gray-900">
            {role === 'Customer' ? (customerInfo?.name || 'Customer') : (profile?.name || role)}
          </h3>
          <span className="text-[11px] font-bold uppercase tracking-wider text-white bg-gradient-to-r from-[#b33842] to-[#bf4a53] px-2.5 py-1 rounded-lg mt-1.5 inline-block shadow-sm shadow-red-500/20">
            {role} Role
          </span>
        </div>

        {role === 'Customer' ? (
          editCustomer ? (
            <div className="space-y-3">
              <input type="text" value={localCustomer.name} onChange={(e) => setLocalCustomer({ ...localCustomer, name: e.target.value })} className={inputClass} placeholder="Full Name" />
              <input type="text" value={localCustomer.contact} onChange={(e) => setLocalCustomer({ ...localCustomer, contact: e.target.value })} className={inputClass} placeholder="Contact Number" />
              <input type="text" value={localCustomer.address} onChange={(e) => setLocalCustomer({ ...localCustomer, address: e.target.value })} className={inputClass} placeholder="Address" />
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Interested In</label>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {ITEM_TYPES.map((type) => {
                    const active = (localCustomer.preferences || []).includes(type);
                    return (
                      <button
                        type="button"
                        key={type}
                        onClick={() =>
                          setLocalCustomer((prev) => {
                            const has = (prev.preferences || []).includes(type);
                            return {
                              ...prev,
                              preferences: has
                                ? prev.preferences.filter((t) => t !== type)
                                : [...(prev.preferences || []), type],
                            };
                          })
                        }
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${active ? 'bg-[#bf4a53] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveCustomer} className="px-4 py-2 bg-[#bf4a53] text-white rounded-full text-sm font-bold hover:bg-red-700 transition-colors">Save</button>
                <button onClick={() => { setEditCustomer(false); setLocalCustomer(customerInfo); }} className="px-4 py-2 border border-gray-200 rounded-full text-sm font-bold hover:bg-gray-50 transition-colors">Cancel</button>
              </div>
              {saveMessage && <p className="text-xs text-emerald-600 font-bold mt-1">{saveMessage}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase">Name</p>
              <p className="text-sm font-medium text-gray-900">{customerInfo.name}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase mt-3">Contact</p>
              <p className="text-sm font-medium text-gray-900">{customerInfo.contact}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase mt-3">Address</p>
              <p className="text-sm font-medium text-gray-900">{customerInfo.address}</p>
              {customerInfo.preferences?.length > 0 && (
                <>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mt-3">Interested In</p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {customerInfo.preferences.map((p) => (
                      <span key={p} className="px-2.5 py-1 bg-red-50 text-[#bf4a53] rounded-full text-[11px] font-bold">{p}</span>
                    ))}
                  </div>
                </>
              )}
              <button
                onClick={() => { setLocalCustomer({ ...customerInfo, preferences: customerInfo?.preferences || [] }); setEditCustomer(true); }}
                className="mt-3 text-xs font-bold text-[#bf4a53] hover:underline"
              >
                Edit Profile
              </button>
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100/80">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Email Address</label>
              <p className="text-sm font-medium text-gray-900">{profile?.email || '—'}</p>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase">Phone</label>
              <p className="text-sm font-medium text-gray-900">{profile?.phone || '—'}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}