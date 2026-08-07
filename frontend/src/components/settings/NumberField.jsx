// Labeled numeric input with optional ₱ prefix / unit suffix and clamp-to-min
// behavior, matching the General tab's policy/automation editing rows.
export default function NumberField({ label, value, onChange, min = 0, max, prefix, suffix, widthClass = 'w-24', hint }) {
  return (
    <div>
      {label && <label className="text-xs font-bold text-gray-500 block mb-1.5">{label}</label>}
      <div className="flex items-center gap-2">
        {prefix && <span className="text-sm text-gray-500">{prefix}</span>}
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            let v = parseInt(e.target.value, 10);
            if (Number.isNaN(v)) v = min;
            v = Math.max(min, v);
            if (max != null) v = Math.min(max, v);
            onChange(v);
          }}
          className={`${widthClass} p-2.5 bg-gray-50 rounded-xl border border-gray-200/80 text-sm text-center font-medium focus:outline-none focus:bg-white focus:border-[#bf4a53]`}
        />
        {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-gray-400 mt-1.5">{hint}</p>}
    </div>
  );
}