// Category performance: utilisation vs revenue-share bars per category.
// Pure presentational.
import { fmt } from './shared';

export default function CategoryPerformance({ utilData }) {
  return (
    <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm lg:col-span-2">
      <h3 className="font-bold text-gray-900 text-lg mb-5">Category Performance</h3>
      {utilData.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No category data.</p>
      ) : (
        <div className="space-y-5">
          {utilData.map(u => {
            const maxCatRev = Math.max(...utilData.map(x => x.revenue), 1);
            const revPct = (u.revenue / maxCatRev) * 100;
            return (
              <div key={u.category}>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-sm font-semibold text-gray-700 capitalize">{u.category}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500">{u.rate}% utilised</span>
                    <span className="font-bold text-gray-900">{u.revenue > 0 ? fmt(u.revenue) : '—'}</span>
                  </div>
                </div>
                <div className="flex gap-1.5 h-2">
                  <div className="flex-1 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#bf4a53]" style={{ width: `${u.rate}%` }} />
                  </div>
                  <div className="flex-1 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gray-900" style={{ width: `${revPct}%` }} />
                  </div>
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>Utilisation</span>
                  <span>Revenue share</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
