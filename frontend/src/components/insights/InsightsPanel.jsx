// Insights panel: rule-based highlights or on-demand AI suggestions in a
// scrollable list. Pure presentational — generation lives in the parent.
import { Lightbulb, Sparkles, Loader2 } from 'lucide-react';
import { Skeleton } from '../Skeleton';

export default function InsightsPanel({
  role, aiSuggestions, suggestLoading, handleAiSuggest, insights,
}) {
  return (
    <div className="bg-white rounded-3xl p-5 md:p-6 border border-gray-100/80 shadow-sm flex flex-col min-h-0">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-[#bf4a53]/10 text-[#bf4a53] flex items-center justify-center shrink-0">
          <Lightbulb size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-base md:text-lg leading-tight">Insights</h3>
          <p className="text-[11px] text-gray-400 font-medium mt-0.5">
            {aiSuggestions?.length ? 'AI-generated promo & restock suggestions' : 'Rule-based highlights from live data'}
          </p>
        </div>
        {(aiSuggestions?.length || insights.length) > 0 && (
          <span className="text-[11px] font-bold text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5 shrink-0">
            {aiSuggestions?.length || insights.length}
          </span>
        )}
      </div>
      {role === 'Admin' && (
        <button onClick={() => handleAiSuggest(Boolean(aiSuggestions))} disabled={suggestLoading}
          className={`mt-3 w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-xl transition-all active:scale-[0.99] disabled:opacity-50 ${
            aiSuggestions
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
              : 'bg-[#bf4a53] text-white shadow-sm hover:bg-red-700'
          }`}>
          {suggestLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {suggestLoading ? 'Generating…' : aiSuggestions ? 'Refresh AI suggestions' : 'Get AI suggestions'}
        </button>
      )}
      {suggestLoading ? (
        <div className="space-y-3 py-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : aiSuggestions?.length ? (
        <div className="mt-3 min-h-0">
          <ul className="space-y-2.5 overflow-y-auto pr-1 -mr-1 max-h-72">
            {aiSuggestions.map((text, i) => (
              <li key={i} className="flex items-start gap-2.5 p-3 rounded-2xl bg-emerald-50/50 border border-emerald-100/70 text-[13px] text-gray-700 leading-relaxed break-words">
                <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span className="flex-1 min-w-0">{text}</span>
              </li>
            ))}
          </ul>
          {aiSuggestions.length > 4 && (
            <p className="text-[11px] text-gray-400 text-center pt-2">Scroll for more · {aiSuggestions.length} total</p>
          )}
        </div>
      ) : insights.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Not enough data for insights yet.</p>
      ) : (
        <div className="mt-3 min-h-0">
          <ul className="space-y-2.5 overflow-y-auto pr-1 -mr-1 max-h-72">
            {insights.map((text, i) => (
              <li key={i} className="flex items-start gap-2.5 p-3 rounded-2xl bg-gray-50/70 border border-gray-100 text-[13px] text-gray-700 leading-relaxed break-words">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#bf4a53] shrink-0" />
                <span className="flex-1 min-w-0">{text}</span>
              </li>
            ))}
          </ul>
          {insights.length > 4 && (
            <p className="text-[11px] text-gray-400 text-center pt-2">Scroll for more · {insights.length} total</p>
          )}
        </div>
      )}
    </div>
  );
}
