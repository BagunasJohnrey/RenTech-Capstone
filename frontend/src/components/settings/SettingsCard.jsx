// Shared card shell with an icon tile + title + description header row.
export default function SettingsCard({ icon: Icon, iconClass = 'bg-red-50 text-[#bf4a53]', title, desc, action, children }) {
  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm p-5 md:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${iconClass}`}>
            <Icon size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 text-base">{title}</h3>
            {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}