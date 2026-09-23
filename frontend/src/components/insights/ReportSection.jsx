// AI report banner + saved-reports list (one card). The generate handler
// lives in the parent (it touches report state); everything else is props.
import { Sparkles, FileText, Loader2, History, Eye, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ReportSection({
  role, reportLoading, onGenerate,
  recentReports, reportsLoading, reportsPage, REPORTS_PAGE_SIZE, setReportsPage,
  openSavedReport, openingReportId,
}) {
  return (
    <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm overflow-hidden">
      <div className="relative overflow-hidden bg-gradient-to-br from-[#8e323a] via-[#a63f47] to-[#bf4a53] p-4 sm:p-6">
        <div className="absolute -right-10 -top-14 w-44 h-44 rounded-full bg-white/10" />
        <div className="absolute right-16 -bottom-12 w-28 h-28 rounded-full bg-white/5" />
        <div className="relative flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-white shadow-inner shrink-0">
              <Sparkles size={18} />
            </div>
            <h3 className="font-bold text-white text-[15px] lg:text-base leading-tight flex-1">AI Business Report</h3>
          </div>
          <p className="text-[11px] md:text-xs text-white/75 leading-relaxed lg:flex-1 lg:min-w-0">
            A full written breakdown of revenue, demand and inventory — ready in about 30 seconds.
          </p>
          <button onClick={onGenerate}
            disabled={reportLoading}
            className="w-full lg:w-auto shrink-0 inline-flex items-center justify-center gap-2 px-6 py-2.5 lg:py-3 bg-white text-[#a63f47] text-sm font-bold rounded-2xl lg:rounded-full shadow-sm hover:bg-red-50 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {reportLoading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            {reportLoading ? 'Generating…' : 'Generate Report'}
          </button>
        </div>
      </div>
      {role === 'Admin' && (recentReports.length > 0 || reportsLoading) && (
        <div className="p-5 md:p-6 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <History size={16} className="text-gray-400" />
            <h3 className="font-bold text-gray-900 text-sm flex-1">Last saved reports</h3>
            {recentReports.length > 0 && (
              <span className="text-[11px] font-bold text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5">{recentReports.length}</span>
            )}
            {reportsLoading && <Loader2 size={13} className="animate-spin text-gray-400" />}
          </div>
          <div className="space-y-3">
            {recentReports.slice(reportsPage * REPORTS_PAGE_SIZE, reportsPage * REPORTS_PAGE_SIZE + REPORTS_PAGE_SIZE).map((r) => (
              <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl bg-gray-50/70 border border-gray-100">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[13px] font-bold text-gray-900 leading-tight">
                    {new Date(r.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(r.provider || r.model) && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-200/70 text-gray-500">{[r.provider, r.model].filter(Boolean).join(' · ')}</span>
                    )}
                    {r.origin === 'cloud'
                      ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-600">cloud only</span>
                      : r.uploaded
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">cloud ✓</span>
                        : null}
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{r.excerpt || 'Business performance report'}</p>
                </div>
                <button
                  onClick={() => openSavedReport(r.id)}
                  disabled={openingReportId === r.id}
                  className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {openingReportId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                  View
                </button>
              </div>
            ))}
          </div>
          {recentReports.length > REPORTS_PAGE_SIZE && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <span className="text-[11px] text-gray-400 font-semibold tabular-nums">
                Page {reportsPage + 1} of {Math.ceil(recentReports.length / REPORTS_PAGE_SIZE)}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setReportsPage(p => Math.max(0, p - 1))} disabled={reportsPage === 0}
                  aria-label="Previous reports page"
                  className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
                  <ChevronLeft size={15} />
                </button>
                <button onClick={() => setReportsPage(p => Math.min(Math.ceil(recentReports.length / REPORTS_PAGE_SIZE) - 1, p + 1))}
                  disabled={reportsPage >= Math.ceil(recentReports.length / REPORTS_PAGE_SIZE) - 1}
                  aria-label="Next reports page"
                  className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30">
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
