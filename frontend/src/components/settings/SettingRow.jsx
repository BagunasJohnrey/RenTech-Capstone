export default function SettingRow({ label, desc, children }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-gray-50/70 border border-gray-100">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
  );
}