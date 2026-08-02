export default function StatCard({ title, value, trend, icon: Icon, isWarning, isAlert, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-3xl p-5 border border-gray-100/80 shadow-sm hover:shadow-md transition-shadow duration-300 ${
        onClick ? 'cursor-pointer' : ''
      }`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className={`p-2.5 rounded-2xl ${
            isAlert ? 'bg-red-50 text-red-500' : isWarning ? 'bg-orange-50 text-orange-400' : 'bg-gray-50 text-gray-500'
          }`}
        >
          <Icon size={20} />
        </div>
        <span
          className={`text-[11px] font-bold px-2.5 py-1 rounded-md tracking-wide ${
            trend.includes('+') ? 'bg-emerald-50 text-emerald-600' :
            trend.includes('-') ? 'bg-red-50 text-red-500' :
            'bg-gray-100 text-gray-600'
          }`}
        >
          {trend}
        </span>
      </div>
      <p className="text-[13px] text-gray-500 font-medium mb-0.5">{title}</p>
      <h4 className="text-2xl font-bold text-gray-900">{value}</h4>
    </div>
  );
}