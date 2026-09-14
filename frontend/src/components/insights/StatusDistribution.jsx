// Status distribution donut + legend. Pure presentational.
import {
  Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Sector
} from 'recharts';
import { STATUS_ICONS } from './shared';

export default function StatusDistribution({ totalTx, statusDist, activePie, setActivePie }) {
  return (
    <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-4">
      <h3 className="font-bold text-gray-900 text-lg">Status Distribution</h3>
      {totalTx === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No transactions yet.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={statusDist}
                cx="50%" cy="50%"
                innerRadius={58} outerRadius={82}
                dataKey="value"
                activeIndex={activePie}
                activeShape={(props) => { const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props; return <g><Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} /><Sector cx={cx} cy={cy} innerRadius={innerRadius - 4} outerRadius={innerRadius - 2} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.3} /></g>; }}
                onMouseEnter={(_, i) => setActivePie(i)}
                onMouseLeave={() => setActivePie(null)}
              >
                {statusDist.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-2">
            {statusDist.map(d => {
              const Icon = STATUS_ICONS[d.name];
              return (
                <div key={d.name} className="flex items-center gap-2 p-2 bg-gray-50 rounded-xl">
                  <Icon size={14} style={{ color: d.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-600">{d.name}</p>
                    <p className="text-sm font-bold text-gray-900">{d.value} <span className="text-xs font-normal text-gray-400">({Math.round((d.value / totalTx) * 100)}%)</span></p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
