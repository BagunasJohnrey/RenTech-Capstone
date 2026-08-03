import { useState, useEffect, cloneElement } from 'react';
import {
  BarChart3, TrendingUp, DollarSign,
  AlertTriangle, Lightbulb, FileText, Loader2, Clock, RotateCcw, XCircle, Download, Sparkles
} from 'lucide-react';
import {
  ComposedChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
  PieChart, Pie, Sector
} from 'recharts';
import AIReportModal from '../components/AIReportModal';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';
import { AIInsightsSkeleton } from '../components/PageSkeletons';
import { Skeleton } from '../components/Skeleton';
import { TX_STATUS_HEX } from '../utils/statusColors';

const fmt = (n) => `₱${Number(n).toLocaleString()}`;
const shortMonth = (l) => l?.split(' ')[0] || '';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-bold text-gray-900 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-gray-600" style={{ color: p.color }}>
          {p.name}: {p.name.includes('Revenue') ? fmt(p.value) : p.value}
        </p>
      ))}
    </div>
  );
};

const STATUS_COLORS = { Active: TX_STATUS_HEX.Active, Overdue: TX_STATUS_HEX.Overdue, Returned: TX_STATUS_HEX.Returned, Cancelled: TX_STATUS_HEX.Cancelled };
const STATUS_ICONS = { Active: Clock, Overdue: AlertTriangle, Returned: RotateCcw, Cancelled: XCircle };

const TIME_OPTIONS = ['Overall', 'Yearly', 'Monthly'];

// 60s TTL cache per time range — same pattern as useKpis/useTodayTasks so
// tab switches and range toggles render instantly instead of re-querying.
const AI_CACHE_TTL_MS = 60_000;
const aiCache = new Map(); // timeRange -> { data, at }

function readAiCache(range) {
  const hit = aiCache.get(range);
  if (!hit) return null;
  if (Date.now() - hit.at > AI_CACHE_TTL_MS) return null;
  return hit.data;
}

// AI-generated promo/restock suggestions — cached in localStorage for 1 day
// (survives reloads; refresh button forces a fresh call). Deliberately not
// auto-called on every page load: Gemini is slow + costs money.
const AI_SUGGEST_TTL_MS = 24 * 60 * 60 * 1000;
const AI_SUGGEST_KEY = 'rentech_ai_suggestions';
const aiSuggestCache = new Map();

function readAiSuggestCache() {
  const mem = aiSuggestCache.get('all');
  if (mem && Date.now() - mem.at <= AI_SUGGEST_TTL_MS) return mem.data;
  try {
    const raw = localStorage.getItem(AI_SUGGEST_KEY);
    if (!raw) return null;
    const { data, at } = JSON.parse(raw);
    if (Date.now() - at <= AI_SUGGEST_TTL_MS) {
      aiSuggestCache.set('all', { data, at });
      return data;
    }
    localStorage.removeItem(AI_SUGGEST_KEY);
  } catch {
    // corrupted/blocked storage — treat as no cache
  }
  return null;
}

function writeAiSuggestCache(data) {
  const at = Date.now();
  aiSuggestCache.set('all', { data, at });
  try {
    localStorage.setItem(AI_SUGGEST_KEY, JSON.stringify({ data, at }));
  } catch {
    // storage unavailable — in-memory cache still works for this session
  }
}

function extractRecommendations(report) {
  if (!report) return [];
  const lines = String(report).split('\n').map(l => l.trim());
  const idx = lines.findIndex(l => /^recommendations\s*:?$/i.test(l));
  if (idx === -1) return [];
  return lines.slice(idx + 1).filter(l => l.length > 0);
}

export default function AIInsightsView({ analyticsData, role }) {
  const [showReportModal, setShowReportModal] = useState(false);
  const [aiReport, setAiReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [activePie, setActivePie] = useState(null);
  const [timeRange, setTimeRange] = useState('Overall');

  const cached = readAiCache(timeRange);
  const [kpis, setKpis] = useState(cached?.kpis ?? null);
  const [forecast, setForecast] = useState(cached?.forecast ?? null);
  const [insightsData, setInsightsData] = useState(cached?.insights ?? null);
  const [revenueChartData, setRevenueChartData] = useState(cached?.insights?.revenueByMonth ?? null);
  const [inventoryAnalytics, setInventoryAnalytics] = useState(cached?.analytics ?? null);
  const [analyticsSummary, setAnalyticsSummary] = useState(cached?.analytics?.summary ?? null);
  const [loading, setLoading] = useState(!cached);
  const [aiSuggestions, setAiSuggestions] = useState(() => readAiSuggestCache());
  const [suggestLoading, setSuggestLoading] = useState(false);
  const { error: toastError } = useToast();

  useEffect(() => {
    const range = timeRange;
    let active = true;
    const periodParam = range === 'Overall' ? '' : `period=${range.toLowerCase()}`;
    if (!readAiCache(range)) setLoading(true);
    Promise.all([
      api.get(`/dashboard/kpis?${periodParam}`),
      api.get('/dashboard/forecast?period=3'),
      api.get(`/dashboard/insights?${periodParam}`),
      api.get(`/inventory/analytics?${periodParam}`),
    ]).then(([kpiResult, forecastResult, insightsResult, analyticsFull]) => {
      if (!active) return;
      const payload = {
        kpis: kpiResult,
        forecast: forecastResult,
        insights: insightsResult,
        analytics: analyticsFull,
      };
      aiCache.set(range, { data: payload, at: Date.now() });
      setKpis(payload.kpis);
      setForecast(payload.forecast);
      setInsightsData(payload.insights);
      setRevenueChartData(payload.insights?.revenueByMonth || []);
      setInventoryAnalytics(payload.analytics);
      setAnalyticsSummary(payload.analytics?.summary);
    }).catch((err) => {
      // FIX D: surface the dashboard/KPI load failure instead of silently
      // rendering zeroed charts.
      toastError(err?.message || 'Failed to load dashboard data');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [timeRange]);

  // FIX D: surface export failures instead of throwing unhandled.
  const handleExport = async (url, filename) => {
    try {
      await api.download(url, filename);
    } catch (err) {
      alert(err?.message || 'Export failed. Please try again.');
    }
  };

  // On-demand AI suggestions (promo/restock recommendations) — reuses the
  // admin-only /ai/generate-report endpoint. Cached 1 day (localStorage);
  // passing force=true (Refresh AI button) always regenerates.
  const handleAiSuggest = async (force = false) => {
    if (suggestLoading) return;
    if (!force) {
      const hit = readAiSuggestCache();
      if (hit) {
        setAiSuggestions(hit);
        return;
      }
    }
    setSuggestLoading(true);
    try {
      const r = await api.post('/ai/generate-report');
      const suggestions = extractRecommendations(r.report || r);
      if (suggestions.length === 0) {
        toastError('AI report came back in an unexpected format — showing static insights.');
        setAiSuggestions(null);
        return;
      }
      writeAiSuggestCache(suggestions);
      setAiSuggestions(suggestions);
    } catch (err) {
      toastError(err?.message || 'Failed to generate AI suggestions');
      setAiSuggestions(null);
    } finally {
      setSuggestLoading(false);
    }
  };

  if (loading) {
    return <AIInsightsSkeleton />;
  }

  // -- Raw data --
  const fLabels = forecast?.labels || [];
  const fCounts = forecast?.counts || [];
  const fSma = forecast?.sma || [];


  const revByMonth = revenueChartData || insightsData?.revenueByMonth || [];
  const thisMonthRev = kpis?.monthlyRevenue || 0;
  const prevMonthRev = kpis?.prevMonthRevenue || 0;
  const revChange = prevMonthRev > 0 ? ((thisMonthRev - prevMonthRev) / prevMonthRev) * 100 : 0;
  const rentedCount = insightsData?.totalRented || 0;
  const totalItems = kpis?.totalItems ?? 0;

  const catBreakdown = insightsData?.categoryBreakdown || {};
  const catRevenue = insightsData?.revenueByCategory || {};

  const utilData = Object.entries(catBreakdown).map(([cat, s]) => ({
    category: cat,
    rate: s.total > 0 ? Math.round((s.rented / s.total) * 100) : 0,
    total: s.total,
    revenue: catRevenue[cat] || 0,
  }));

  const underperforming = insightsData?.underperforming || [];
  const topRented = insightsData?.topRented || [];
  const popularItems = topRented.slice(0, 5);

  // -- Status distribution --
  const statusDist = [
    { name: 'Active', value: kpis?.activeRentals ?? 0, color: STATUS_COLORS.Active },
    { name: 'Overdue', value: kpis?.overdueReturns ?? 0, color: STATUS_COLORS.Overdue },
    { name: 'Returned', value: kpis?.returnedCount ?? 0, color: STATUS_COLORS.Returned },
    { name: 'Cancelled', value: kpis?.cancelledCount ?? 0, color: STATUS_COLORS.Cancelled },
  ].filter(d => d.value > 0);
  const totalTx = statusDist.reduce((s, d) => s + d.value, 0);

  // -- SMA data --
  const smaVals = fSma.filter(v => v !== null && v !== undefined);
  const latestSmaVal = smaVals.length > 0 ? smaVals[smaVals.length - 1] : 0;
  const prevSmaVal = smaVals.length >= 2 ? smaVals[smaVals.length - 2] : 0;
  const smaTrend = latestSmaVal > prevSmaVal ? 'up' : latestSmaVal < prevSmaVal ? 'down' : 'stable';

  const avgPrice = fCounts.length > 0 && fCounts[fCounts.length - 1] > 0
    ? (revByMonth[revByMonth.length - 1]?.revenue || 0) / fCounts[fCounts.length - 1]
    : 1500;
  const forecastRev = latestSmaVal * avgPrice;

  const nextLabel = fLabels.length > 0
    ? (() => {
        const p = fLabels[fLabels.length - 1].split(' ');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const idx = months.indexOf(p[0]);
        if (idx === -1) return 'Next';
        const nextIdx = (idx + 1) % 12;
        return `${months[nextIdx]} ${nextIdx === 0 ? +p[1] + 1 : p[1]}`;
      })()
    : 'Next';

  // -- Chart data --
  const forecastData = fLabels.map((l, i) => ({
    label: shortMonth(l),
    full: l,
    count: fCounts[i] || 0,
    sma: fSma[i] ?? null,
  }));
  forecastData.push({
    label: shortMonth(nextLabel),
    full: nextLabel,
    count: null,
    sma: latestSmaVal,
    forecast: true,
  });
  const validSmaCount = forecastData.filter(d => d.sma !== null && !d.forecast).length;
  const hasSma = validSmaCount >= 2;
  const countChart = fLabels.map(l => ({ label: shortMonth(l), full: l, count: fCounts[fLabels.indexOf(l)] || 0 }));

  const revChart = (revByMonth || [])
    .map(d => ({ label: shortMonth(d.label), full: d.label, rev: d.revenue }))
    .filter(d => d.rev > 0);
  if (revChart.length === 0 && revByMonth.length > 0) {
    const last = revByMonth[revByMonth.length - 1];
    revChart.push({ label: shortMonth(last.label), full: last.label, rev: 0 });
  }
  if (forecastRev > 0 || revChart.length > 0)
    revChart.push({ label: shortMonth(nextLabel), full: nextLabel, rev: forecastRev, forecast: true });

  // -- Insights --
  const insights = [];
  if (popularItems.length > 0)
    insights.push(`"${popularItems[0].name}" is the most rented item (${popularItems[0].rentals}x).`);
  const highUtil = utilData.find(u => u.rate >= 80);
  if (highUtil) insights.push(`High utilisation in ${highUtil.category} (${highUtil.rate}%).`);
  if (underperforming.length > 0)
    insights.push(`${underperforming.length} item(s) have never been rented – consider promotions or clearance.`);
  const prevSma = smaVals.length >= 2 ? smaVals[smaVals.length - 2] : 0;
  if (latestSmaVal > prevSma)
    insights.push(`Next month demand forecast is ${Math.round(latestSmaVal - prevSma)} rental(s) higher than this month.`);
  if (kpis?.overdueReturns > 0)
    insights.push(`${kpis.overdueReturns} overdue rental(s) need immediate attention.`);
  if (revChange > 0)
    insights.push(`Monthly revenue is up ${revChange.toFixed(0)}% compared to last month.`);
  else if (revChange < 0)
    insights.push(`Monthly revenue is down ${Math.abs(revChange).toFixed(0)}% compared to last month.`);



  // -- Render --
  return (
    <>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Business Intelligence</h2>
            <p className="text-sm text-gray-500 mt-1">Real-time analytics powered by your transaction and inventory data.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex bg-gray-100 rounded-full p-0.5">
              {TIME_OPTIONS.map(t => (
                <button key={t} onClick={() => setTimeRange(t)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors ${timeRange === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="w-px h-6 bg-gray-200" />
            <button onClick={() => handleExport('/export/transactions', 'transactions.csv')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors" title="Export Transactions">
              <Download size={16} />
            </button>
            <button onClick={() => handleExport('/export/revenue', 'revenue.csv')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors" title="Export Revenue">
              <DollarSign size={16} />
            </button>
            <button onClick={() => handleExport('/export/inventory', 'inventory.csv')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors" title="Export Inventory">
              <BarChart3 size={16} />
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
            <div className="p-2 bg-emerald-50 rounded-xl inline-block text-emerald-500 mb-2">
              <DollarSign size={16} />
            </div>
            <p className="text-[10px] md:text-xs text-gray-500 font-medium">Monthly Revenue</p>
            <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">{fmt(thisMonthRev)}</h4>
            {prevMonthRev > 0 && (
              <span className={`text-[10px] md:text-xs font-semibold ${revChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {revChange >= 0 ? '+' : ''}{Math.abs(revChange).toFixed(0)}%
              </span>
            )}
          </div>
          <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
            <div className="p-2 bg-orange-50 rounded-xl inline-block text-orange-500 mb-2">
              <BarChart3 size={16} />
            </div>
            <p className="text-[10px] md:text-xs text-gray-500 font-medium">Items Rented</p>
            <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">{rentedCount}<span className="text-xs md:text-sm font-medium text-gray-400">/{totalItems}</span></h4>
            <span className="text-[10px] md:text-xs font-semibold text-gray-500">{totalItems > 0 ? Math.round((rentedCount / totalItems) * 100) : 0}%</span>
          </div>
          <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
            <div className="p-2 bg-purple-50 rounded-xl inline-block text-purple-500 mb-2">
              <TrendingUp size={16} />
            </div>
            <p className="text-[10px] md:text-xs text-gray-500 font-medium">Forecast</p>
            <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">
              {smaVals.length >= 2 ? `${Math.round(latestSmaVal)}` : '—'}
            </h4>
            {smaVals.length >= 2 && <span className="text-[10px] md:text-xs font-semibold text-gray-500">{fmt(forecastRev)}</span>}
          </div>
          {analyticsSummary && (
            <>
              <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
                <div className="p-2 bg-emerald-50 rounded-xl inline-block text-emerald-500 mb-2">
                  <DollarSign size={16} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 font-medium">Inventory Revenue</p>
                <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">₱{analyticsSummary.totalRevenue.toLocaleString()}</h4>
              </div>
              <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
                <div className="p-2 bg-orange-50 rounded-xl inline-block text-orange-500 mb-2">
                  <RotateCcw size={16} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 font-medium">Total Rentals</p>
                <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">{analyticsSummary.totalRentals}</h4>
              </div>
              <div className="bg-white rounded-2xl p-4 md:p-5 border border-gray-100/80 shadow-sm">
                <div className="p-2 bg-purple-50 rounded-xl inline-block text-purple-500 mb-2">
                  <TrendingUp size={16} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 font-medium">Avg Utilization</p>
                <h4 className="text-base md:text-xl font-bold text-gray-900 mt-0.5">{analyticsSummary.avgUtilization}%</h4>
              </div>
            </>
          )}
        </div>

        {analyticsData && (
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm overflow-hidden">
            {cloneElement(analyticsData, { period: timeRange, initialData: inventoryAnalytics })}
          </div>
        )}

        {/* Row 1: Revenue Chart + Status Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2 overflow-hidden">
            <h3 className="font-bold text-gray-900 text-base md:text-lg px-5 md:px-7 pt-5 md:pt-7 pb-2">Monthly Revenue</h3>
            <p className="text-xs md:text-sm text-gray-400 px-5 md:px-7 pb-4">Revenue trend with next month projection</p>
            {revChart.length === 0 || revChart.every(d => d.rev === 0) ? (
              <p className="text-sm text-gray-400 text-center py-12">No revenue data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={revChart} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f9fafb' }} />
                  <Bar dataKey="rev" name="Revenue" radius={[6, 6, 0, 0]} maxBarSize={56}>
                    {revChart.map((e, i) => (
                      <Cell key={i} fill={e.forecast ? '#bf4a53' : '#1f2937'} fillOpacity={e.forecast ? 0.25 : 1} stroke={e.forecast ? '#bf4a53' : 'none'} strokeWidth={e.forecast ? 2 : 0} strokeDasharray={e.forecast ? '4 3' : 'none'} />
                    ))}
                  </Bar>
                  <ReferenceLine y={0} stroke="#e5e7eb" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-4">
            <h3 className="font-bold text-gray-900 text-lg">Status Distribution</h3>
            {totalTx === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No transactions yet.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={statusDist}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={85}
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
        </div>

        {/* Row 2: Demand Forecast + Top Items */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2">
            <h3 className="font-bold text-gray-900 text-base md:text-lg px-5 md:px-7 pt-5 md:pt-7 pb-2">Demand Forecast</h3>
            <p className="text-xs md:text-sm text-gray-400 px-5 md:px-7 pb-4">3‑month moving average with rental counts</p>
            {!hasSma ? (
              <div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={countChart} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" name="Rentals" radius={[4, 4, 0, 0]} maxBarSize={56} fill="#1f2937" />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 text-center pb-4 px-7">At least {3 - validSmaCount} more months of data needed for SMA trend.</p>
              </div>
            ) : (
              <div>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={forecastData} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const month = forecastData.find(d => d.label === label);
                        return (
                          <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm space-y-1">
                            <p className="font-bold text-gray-900">{month?.full || label}</p>
                            {payload.map((p, i) => (
                              p.value !== null && <p key={i} className="text-gray-600" style={{ color: p.color }}>
                                {p.name}: {p.name === 'SMA (3mo)' ? Number(p.value).toFixed(1) : p.value}
                              </p>
                            ))}
                            {month?.forecast && <p className="text-[11px] text-gray-400 italic">Projected</p>}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="count" name="Rentals" radius={[4, 4, 0, 0]} maxBarSize={48} fill="#1f2937" fillOpacity={0.35} />
                    <Line type="monotone" dataKey="sma" name="SMA (3mo)" stroke="#bf4a53" strokeWidth={3}
                      dot={{ r: 5, fill: '#bf4a53', strokeWidth: 0 }}
                      activeDot={{ r: 8, fill: '#bf4a53', stroke: '#fff', strokeWidth: 2 }}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>

                {/* SMA Summary */}
                <div className="grid grid-cols-3 gap-2 md:gap-3 px-5 md:px-7 pb-5 md:pb-6">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-[11px] text-gray-500 font-medium">Current SMA</p>
                    <p className="text-lg font-bold text-gray-900">{latestSmaVal.toFixed(1)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-[11px] text-gray-500 font-medium">Previous</p>
                    <p className="text-lg font-bold text-gray-900">{prevSmaVal.toFixed(1)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-[11px] text-gray-500 font-medium">Trend</p>
                    <p className={`text-lg font-bold flex items-center justify-center gap-1 ${smaTrend === 'up' ? 'text-emerald-600' : smaTrend === 'down' ? 'text-red-500' : 'text-gray-500'}`}>
                      {smaTrend === 'stable' ? 'Flat' : `${Math.abs(latestSmaVal - prevSmaVal).toFixed(1)}`}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-4">
            <h3 className="font-bold text-gray-900 text-lg">Top Rented Items</h3>
            {popularItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No rentals yet.</p>
            ) : (
              <div className="space-y-4">
                {popularItems.map((item, i) => {
                  const pct = Math.min((item.rentals / Math.max(...popularItems.map(t => t.rentals), 1)) * 100, 100);
                  return (
                    <div key={item.id}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700 truncate flex-1">{i + 1}. {item.name}</span>
                        <span className="font-bold text-gray-900 ml-2">{item.rentals}x</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-[#bf4a53]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {underperforming.length > 0 && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-orange-500 mb-2">{underperforming.length} item(s) never rented</p>
                <div className="flex flex-wrap gap-1.5">
                  {underperforming.slice(0, 4).map(item => (
                    <span key={item.id} className="px-2 py-1 bg-orange-50 text-orange-600 rounded-lg text-[11px] font-medium">{item.name}</span>
                  ))}
                  {underperforming.length > 4 && <span className="px-2 py-1 bg-gray-50 text-gray-400 rounded-lg text-[11px]">+{underperforming.length - 4}</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Category Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

          <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb size={18} className="text-[#bf4a53]" />
              <h3 className="font-bold text-gray-900 text-lg flex-1">Insights</h3>
              {role === 'Admin' && (
                <button onClick={() => handleAiSuggest(Boolean(aiSuggestions))} disabled={suggestLoading}
                  className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full transition-colors disabled:opacity-50 ${
                    aiSuggestions
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                      : 'bg-[#bf4a53] text-white shadow-sm hover:bg-red-700'
                  }`}>
                  {suggestLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {suggestLoading ? 'Generating...' : aiSuggestions ? 'Refresh AI' : 'AI Suggestions'}
                </button>
              )}
            </div>
            {suggestLoading ? (
              <div className="space-y-3 py-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : aiSuggestions?.length ? (
              <>
                <p className="text-[11px] text-gray-400 font-medium">AI-generated promo &amp; restock suggestions</p>
                <ul className="space-y-2">
                  {aiSuggestions.map((text, i) => (
                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      {text}
                    </li>
                  ))}
                </ul>
              </>
            ) : insights.length === 0 ? (
              <p className="text-sm text-gray-400">Not enough data for insights yet.</p>
            ) : (
              <ul className="space-y-2">
                {insights.map((text, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#bf4a53] shrink-0" />
                    {text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* AI Report button */}
        <div className="flex justify-end">
          <button onClick={() => { setReportLoading(true); api.post('/ai/generate-report').then(r => { setAiReport(r.report || r); setShowReportModal(true); }).catch((err) => { setAiReport(null); alert(err?.message || 'Failed to generate AI report.'); }).finally(() => setReportLoading(false)); }}
            disabled={reportLoading}
            className="flex items-center gap-2 px-6 py-3 bg-[#bf4a53] text-white font-semibold rounded-full shadow-md shadow-red-500/20 hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {reportLoading ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
            {reportLoading ? 'Generating...' : 'Generate AI Report'}
          </button>
        </div>
      </div>

      {showReportModal && <AIReportModal geminiReport={aiReport} onClose={() => { setShowReportModal(false); setAiReport(null); }} />}
    </>
  );
}

