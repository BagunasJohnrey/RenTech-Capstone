// Standard page title block: one heading size across admin/staff pages, with
// optional subtitle and right-aligned actions (wrap under the title on phones).
export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 font-medium mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
