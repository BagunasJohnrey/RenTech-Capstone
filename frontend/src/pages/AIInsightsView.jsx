import { useState, useEffect, useCallback, cloneElement } from 'react';
import {
  BarChart3, TrendingUp, DollarSign, ChevronLeft, ChevronRight,
  AlertTriangle, Lightbulb, FileText, Loader2, Clock, RotateCcw, XCircle, Download, Sparkles, History, Eye, X, Tag
} from 'lucide-react';
import {
  ComposedChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine, ReferenceDot,
  PieChart, Pie, Sector
} from 'recharts';
import AIReportModal from '../components/AIReportModal';
import ItemImage from '../components/ItemImage';
import SaleModal from '../components/SaleModal';
import CleaningQueueModal from '../components/CleaningQueueModal';
import { api } from '../utils/api';
import { reorderSuggestions, clearanceSuggestions, cleaningPriority } from '../utils/optimization';
import { useToast } from '../components/Toast';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { AIInsightsSkeleton } from '../components/PageSkeletons';
import { Skeleton } from '../components/Skeleton';
import { TX_STATUS_HEX } from '../utils/statusColors';

const fmt = (n) => `₱${Math.round(Number(n)).toLocaleString()}`;
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

// Revenue-chart tooltip: shows the full "Mar 2026" label and clearly marks the
// projection bar so it isn't mistaken for actual revenue.
const RevenueTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-bold text-gray-900">{p.full}{p.forecast ? ' (projected)' : ''}</p>
      <p className="text-gray-600">{p.rev <= 0 && !p.forecast ? 'No revenue' : fmt(p.rev)}</p>
    </div>
  );
};

const STATUS_COLORS = { Active: TX_STATUS_HEX.Active, Overdue: TX_STATUS_HEX.Overdue, Returned: TX_STATUS_HEX.Returned, Cancelled: TX_STATUS_HEX.Cancelled };
const STATUS_ICONS = { Active: Clock, Overdue: AlertTriangle, Returned: RotateCcw, Cancelled: XCircle };

const TIME_OPTIONS = ['Overall', 'Yearly', 'Monthly'];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Philippine event/seasonality annotations for the monthly forecast chart
// (display only for now — the SMA math itself is unweighted).
const SEASON_MARKERS = {
  0: 'New Year', 1: "Valentine's", 2: 'Graduation', 5: 'Wedding season',
  9: 'Halloween', 11: 'Christmas · Wedding season',
};
const CONFIDENCE_STYLES = {
  low: 'bg-amber-50 text-amber-700',
  medium: 'bg-blue-50 text-blue-700',
  high: 'bg-emerald-50 text-emerald-700',
};

// Pickers clamp to now* so users can look BACK at any past month/year but not
// into the future. (* milliseconds-since-epoch comparison.)

// Cache per time range — same pattern as useKpis/useTodayTasks so tab switches
// and range toggles render instantly instead of re-querying. Fresh snapshots
// (<= FRESH_TTL) skip the network entirely; older-but-present snapshots
// (<= STALE_TTL) still paint instantly and refresh silently in the background.
const AI_CACHE_FRESH_MS = 60_000;
const AI_CACHE_STALE_MS = 10 * 60_000;
const aiCache = new Map(); // cache key -> { data, at }

function readAiCache(key) {
  const hit = aiCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > AI_CACHE_STALE_MS) return null;
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

// Pulls the numbered recommendations out of the AI report text. Provider models
// format loosely (markdown **bold** headers, "Recommendations:", trailing
// colons), so this accepts a header with optional markdown framing and falls
// back to any numbered lines — the prompt forces recommendations to be numbered
// 1..N with no gaps, so numbered lines are almost always the recommendation list.
function extractRecommendations(report) {
  if (!report) return [];
  const lines = String(report)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const strip = (l) =>
    l
      .replace(/^[#*_>-\s]+/, '')
      .replace(/\s*[#*_>]+$/, '')
      .trim()
      .replace(/^\d{1,2}[.)]\s*\*{0,2}\s*/, '')
      .trim();

  const isHeader = (l) => /^[\s#*_>]*recommendations\s*:?[\s#*_]*$/i.test(l);

  const isMeta = (l) =>
    /^([-#\d.]*)?\s*(executive summary|key performance indicators?|revenue analysis|inventory\s*&?\s*utilization|operational health|demand forecast|data:|kpis?:|insights?:|forecast:|underperforming items)/i.test(l);

  const idx = lines.findIndex(isHeader);
  if (idx !== -1) {
    const recs = lines.slice(idx + 1).map(strip).filter((l) => l.length > 10 && !isMeta(l));
    if (recs.length) return recs;
  }

  const numbered = lines
    .filter((l) => /^\d{1,2}[.)]\s+\S/.test(l))
    .map(strip)
    .filter((l) => l.length > 10);
  return numbered;
}

export default function AIInsightsView({ analyticsData, role, onViewItemTransactions, onNavigateTab, cleaningItems = [], onBulkClean }) {
  const [showReportModal, setShowReportModal] = useState(false);
  const [aiReport, setAiReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const { error: toastError } = useToast();
  // Last saved AI reports (server history, admin-only) — reopenable from here
  // and from Settings → Data & Backups.
  const [recentReports, setRecentReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsPage, setReportsPage] = useState(0);
  const REPORTS_PAGE_SIZE = 3;
  const [openingReportId, setOpeningReportId] = useState(null);
  const loadRecentReports = () => {
    if (role !== 'Admin') return;
    setReportsLoading(true);
    api.get('/ai/reports')
      .then((r) => { setRecentReports(Array.isArray(r) ? r.slice(0, 5) : []); setReportsPage(0); })
      .catch(() => {})
      .finally(() => setReportsLoading(false));
  };
  useEffect(() => { loadRecentReports(); }, [role]);
  const openSavedReport = (id) => {
    if (openingReportId) return;
    setOpeningReportId(id);
    api.get(`/ai/reports/${id}`)
      .then((r) => { setAiReport(r?.report || ''); setShowReportModal(true); })
      .catch(() => toastError('Could not open that report.'))
      .finally(() => setOpeningReportId(null));
  };
  const [activePie, setActivePie] = useState(null);
  const [timeRange, setTimeRange] = useState('Monthly');
  const now0 = new Date();
  const [selYear, setSelYear] = useState(now0.getFullYear());
  const [selMonth, setSelMonth] = useState(now0.getMonth() + 1); // 1-12
  const isCurrentMonth = (y, m) => now0.getFullYear() === y && now0.getMonth() + 1 === m;
  const isCurrentYear = (y) => now0.getFullYear() === y;
  // Clamp the *applied* month/year so picking a future value can't leak into
  // the request — the dropdown options are filtered to the past, but the
  // state setter can hold a stale future value between renders.
  const appliedYear = timeRange === 'Overall' ? undefined : Math.min(Math.max(selYear, 2000), now0.getFullYear());
  const appliedMonth = timeRange === 'Monthly'
    ? (appliedYear === now0.getFullYear() ? Math.min(selMonth, now0.getMonth() + 1) : selMonth)
    : undefined;

  const cacheKey = timeRange === 'Monthly' ? `Monthly:${appliedYear}-${appliedMonth}`
    : timeRange === 'Yearly' ? `Yearly:${appliedYear}`
    : 'Overall';

  const cached = readAiCache(cacheKey);
  const [kpis, setKpis] = useState(cached?.kpis ?? null);
  const [forecast, setForecast] = useState(cached?.forecast ?? null);
  const [insightsData, setInsightsData] = useState(cached?.insights ?? null);
  const [revenueChartData, setRevenueChartData] = useState(cached?.insights?.revenueByMonth ?? null);
  const [revenueWeeklyData, setRevenueWeeklyData] = useState(cached?.insights?.revenueByWeek ?? null);
  const [inventoryAnalytics, setInventoryAnalytics] = useState(cached?.analytics ?? null);
  const [analyticsSummary, setAnalyticsSummary] = useState(cached?.analytics?.summary ?? null);
  // Page renders as soon as the FIRST source arrives (KPIs load fastest), then
  // the remaining sections fill in as their own requests resolve — no full-page
  // skeleton waiting on all 4 endpoints.
  const [loaded, setLoaded] = useState(!!cached);
  // Once the page has painted real content, never drop back to the full-page
  // skeleton — range/period switches would otherwise flash skeleton→content
  // on every cache miss. The sections just stay put until the new data lands.
  const [everRendered, setEverRendered] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(() => readAiSuggestCache());
  const [suggestLoading, setSuggestLoading] = useState(false);
  // Forecast granularity: monthly comes with the bundle; weekly is fetched
  // on demand from /dashboard/forecast?granularity=weekly (admin-only).
  const [granularity, setGranularity] = useState('monthly');
  const [weeklyForecast, setWeeklyForecast] = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  // Full-list modal for the smart-action cards: 'restock' | 'clearance' | 'cleaning' | 'never' | null
  const [smartModal, setSmartModal] = useState(null);
  // Inline sale editor target (opened from clearance / never-rented rows).
  const [saleTarget, setSaleTarget] = useState(null);
  // Cleaning queue modal (opened from clean-next rows, tapped item preselected).
  const [cleanQueue, setCleanQueue] = useState(null);
  const openCleanQueue = (item) => {
    setSmartModal(null);
    setCleanQueue({ preselect: item?.id ?? null });
  };
  // Queue rows: live inventory when provided, else the analytics snapshot.
  const cleanQueueItems = cleaningItems.length > 0
    ? cleaningItems
    : (inventoryAnalytics?.items || []).filter((i) => i.status === 'Cleaning');
  // Timed exit like the transaction sheet: play the fade/slide-out, then unmount.
  const [smartClosing, setSmartClosing] = useState(false);  const openSmartModal = (type) => { setSmartClosing(false); setSmartModal(type); };
  const closeSmartModal = useCallback(() => {
    if (smartClosing) return;
    setSmartClosing(true);
    setTimeout(() => { setSmartModal(null); setSmartClosing(false); }, 150);
  }, [smartClosing]);
  useEscapeClose(closeSmartModal, smartModal !== null);
  const loadWeeklyForecast = () => {
    if (weeklyForecast || weeklyLoading) return;
    setWeeklyLoading(true);
    api.get('/dashboard/forecast?granularity=weekly&period=3')
      .then((r) => setWeeklyForecast(r ?? null))
      .catch(() => {})
      .finally(() => setWeeklyLoading(false));
  };

  useEffect(() => {
    const range = timeRange;
    let active = true;
    const periodParam = range === 'Overall' ? '' : `period=${range.toLowerCase()}`;
    // Month/year selectors pin the window for both KPI cards and the revenue
    // chart. Only the SMA forecast stays global (a full-history trend is the
    // point of that chart).
    const monthParam = range === 'Monthly' ? `&year=${appliedYear}&month=${appliedMonth}` : '';
    const yearParam = range === 'Yearly' ? `&year=${appliedYear}` : '';
    const cacheKey = range === 'Monthly' ? `Monthly:${appliedYear}-${appliedMonth}`
      : range === 'Yearly' ? `Yearly:${appliedYear}`
      : 'Overall';

    // Snapshot present for this range: apply instantly (no skeleton), then fall
    // through to refresh silently in the background below — the requests are
    // server-cached, so the freshness update is cheap and invisible.
    const hit = readAiCache(cacheKey);
    if (hit) {
      setKpis(hit.kpis);
      setForecast(hit.forecast);
      setInsightsData(hit.insights);
      setRevenueChartData(hit.insights?.revenueByMonth || []);
      setRevenueWeeklyData(hit.insights?.revenueByWeek || null);
      setInventoryAnalytics(hit.analytics);
      setAnalyticsSummary(hit.analytics?.summary);
      setLoaded(true);
      setEverRendered(true);
    }
    let settled = false;
    const settle = () => { if (!settled) { settled = true; if (active) { setLoaded(true); setEverRendered(true); } } };
    const fail = (err) => {
      if (!active) return;
      toastError(err?.message || 'Failed to load dashboard data');
      settle();
    };

    // One request for the whole page. The old four-call fan-out (kpis /
    // insights / forecast / inventory-analytics) each paid its own remote
    // pooler round trip on a cold cache and could warm independently — one
    // fresh, one stale. The bundle returns everything under one key so the
    // page paints once, consistently, from a single fetch.
    const params = [`fp=3`, periodParam, monthParam ? monthParam.replace(/^&/, '') : '', yearParam ? yearParam.replace(/^&/, '') : '']
      .filter(Boolean).join('&');
    const pBundle = api.get(`/dashboard/bundle?${params}`)
      .then(r => {
        if (!active) return r;
        setKpis(r?.kpis ?? null);
        setForecast(r?.forecast ?? null);
        setInsightsData(r?.insights ?? null);
        setRevenueChartData(r?.insights?.revenueByMonth || []);
        setRevenueWeeklyData(r?.insights?.revenueByWeek || null);
        setInventoryAnalytics(r?.analytics ?? null);
        setAnalyticsSummary(r?.analytics?.summary ?? null);
        settle();
        return r;
      });

    pBundle.then(r => {
      if (!active || !r) return;
      aiCache.set(cacheKey, {
        data: { kpis: r.kpis, forecast: r.forecast, insights: r.insights, analytics: r.analytics },
        at: Date.now(),
      });
      settle();
    }).catch(() => {
      if (active) fail(new Error('Failed to load dashboard data'));
    });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, appliedYear, appliedMonth]);

  // FIX D: surface export failures instead of throwing unhandled.
  const handleExport = async (url, filename) => {
    try {
      await api.download(url, filename);
    } catch (err) {
      alert(err?.message || 'Export failed. Please try again.');
    }
  };

  // One workbook download (Transactions + Revenue + Inventory sheets) scoped
  // to the selected Overall / Yearly / Monthly window.
  const workbookScopeLabel = timeRange === 'Monthly'
    ? `${SHORT_MONTHS[appliedMonth - 1]} ${appliedYear}`
    : timeRange === 'Yearly' ? `${appliedYear}` : 'Overall';
  const handleWorkbookExport = () => {
    const params = timeRange === 'Overall'
      ? 'period=overall'
      : timeRange === 'Yearly'
        ? `period=yearly&year=${appliedYear}`
        : `period=monthly&year=${appliedYear}&month=${appliedMonth}`;
    const filename = timeRange === 'Monthly'
      ? `rentech-report-${appliedYear}-${String(appliedMonth).padStart(2, '0')}.xlsx`
      : timeRange === 'Yearly'
        ? `rentech-report-${appliedYear}.xlsx`
        : 'rentech-report-overall.xlsx';
    handleExport(`/export/workbook?${params}`, filename);
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
      const r = await api.post('/ai/generate-report', undefined, { timeout: 60000 });
      // Provider down / rate-limited / hallucination-flagged → keep static
      // insights and say so plainly, instead of a confusing format error.
      if (r?.source === 'error') {
        setAiSuggestions(null);
        toastError(r?.retryable
          ? 'AI is currently experiencing high traffic — showing static insights. Please try again in a moment.'
          : /flagged/.test(r.report || '')
            ? 'AI report was rejected because it invented figures — showing static insights.'
            : 'AI generation is temporarily unavailable. Showing static insights — try again in a few minutes.');
        return;
      }
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

  // Full-page skeleton only on the very first paint. After that the page stays
  // mounted and refreshes in place — no skeleton flash on range switches.
  if (!loaded && !everRendered) {
    return <AIInsightsSkeleton />;
  }

  // -- Raw data (forecast follows the Monthly/Weekly toggle; revenue +
  // smart-action rules stay on the monthly series) --
  const activeForecast = granularity === 'weekly' ? (weeklyForecast || forecast) : forecast;
  const fLabels = activeForecast?.labels || [];
  const fCounts = activeForecast?.counts || [];
  const fSma = activeForecast?.sma || [];


  const isMonthlyView = timeRange === 'Monthly';

  const revByMonth = revenueChartData || insightsData?.revenueByMonth || [];
  const revByWeek = revenueWeeklyData || insightsData?.revenueByWeek || null;
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
  // Never-rented items (0x) are NOT "most rented" — filter them out so the
  // static insights and Top Rented card fall back gracefully when there are no
  // rentals yet instead of claiming a 0x item is the store's leader.
  const popularItems = topRented.filter(i => i.rentals > 0).slice(0, 5);

  // -- Status distribution --
  const statusDist = [
    { name: 'Active', value: kpis?.activeRentals ?? 0, color: STATUS_COLORS.Active },
    { name: 'Overdue', value: kpis?.overdueReturns ?? 0, color: STATUS_COLORS.Overdue },
    { name: 'Returned', value: kpis?.returnedCount ?? 0, color: STATUS_COLORS.Returned },
    { name: 'Cancelled', value: kpis?.cancelledCount ?? 0, color: STATUS_COLORS.Cancelled },
  ].filter(d => d.value > 0);
  const totalTx = statusDist.reduce((s, d) => s + d.value, 0);

  // -- SMA data (follows the card toggle) --
  const smaVals = fSma.filter(v => v !== null && v !== undefined);
  const latestSmaVal = smaVals.length > 0 ? smaVals[smaVals.length - 1] : 0;
  const prevSmaVal = smaVals.length >= 2 ? smaVals[smaVals.length - 2] : 0;
  const smaTrend = latestSmaVal > prevSmaVal ? 'up' : latestSmaVal < prevSmaVal ? 'down' : 'stable';
  const showingWeekly = granularity === 'weekly';
  const smaName = showingWeekly ? 'SMA (3wk)' : 'SMA (3mo)';

  // -- Revenue projection math stays monthly no matter the toggle: weekly
  // rental counts must never divide a full month's revenue.
  const mCounts = forecast?.counts || [];
  const mSmaVals = (forecast?.sma || []).filter(v => v !== null && v !== undefined);
  const mLatestSma = mSmaVals.length > 0 ? mSmaVals[mSmaVals.length - 1] : 0;
  const mPrevSma = mSmaVals.length >= 2 ? mSmaVals[mSmaVals.length - 2] : 0;
  const avgPriceKnown = mCounts.length > 0 && mCounts[mCounts.length - 1] > 0;
  const avgPrice = avgPriceKnown
    ? (revByMonth[revByMonth.length - 1]?.revenue || 0) / mCounts[mCounts.length - 1]
    : 1500;
  const forecastRev = mLatestSma * avgPrice;
  // With < 2 real months of revenue, a peso projection is a guess (avg price falls
  // back to a hard-coded 1500), so show the SMA direction rather than an inflated bar.
  const forecastRevValue = avgPriceKnown ? forecastRev : mLatestSma;

  // Next-period label: prefer the server projection label (works for both
  // monthly "Mar 2026" and weekly "Mar 9" labels); fall back to month math.
  const nextLabelFrom = (labels) => {
    const proj = (granularity === 'weekly' ? weeklyForecast : forecast)?.projections || [];
    if (proj.length > 0 && proj[0]?.label) return proj[0].label;
    if (!labels.length) return 'Next';
    const p = labels[labels.length - 1].split(' ');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const idx = months.indexOf(p[0]);
    if (idx === -1 || p.length < 2) return 'Next';
    const nextIdx = (idx + 1) % 12;
    return `${months[nextIdx]} ${nextIdx === 0 ? +p[1] + 1 : p[1]}`;
  };
  const nextLabel = nextLabelFrom(fLabels);
  // Revenue chart's projection bar always talks months — pin it to the
  // monthly series even while the forecast card shows weeks.
  const monthlyNextLabel = nextLabelFrom(forecast?.labels || []);

  // -- Chart data (weekly labels shown in full — shortMonth would
  // collapse every week of a month onto one tick) --
  const forecastData = fLabels.map((l, i) => ({
    label: showingWeekly ? l : shortMonth(l),
    full: l,
    count: fCounts[i] || 0,
    sma: fSma[i] ?? null,
  }));
  forecastData.push({
    label: showingWeekly ? nextLabel : shortMonth(nextLabel),
    full: nextLabel,
    count: null,
    sma: latestSmaVal,
    forecast: true,
  });
  const validSmaCount = forecastData.filter(d => d.sma !== null && !d.forecast).length;
  const hasSma = validSmaCount >= 2;
  const countChart = fLabels.map(l => ({ label: shortMonth(l), full: l, count: fCounts[fLabels.indexOf(l)] || 0 }));

  // Season markers on observed monthly points only (never on projections,
  // never on weekly view).
  const seasonDots = !showingWeekly
    ? forecastData.filter((d) => !d.forecast && d.count !== null && SEASON_MARKERS[SHORT_MONTHS.indexOf(d.full.split(' ')[0])])
    : [];

  // -- Multi-period outlook (server SMA projections) + deterministic rules --
  // The outlook table follows the card's Monthly/Weekly toggle; the smart
  // rules always use the monthly per-category series.
  const projections = activeForecast?.projections || [];
  const forecastCats = forecast?.byCategory || [];
  const analyticsItems = inventoryAnalytics?.items || [];
  // Insights rows (top/underperforming) carry no image — resolve via analytics.
  const imgById = new Map(analyticsItems.map(i => [i.id, i.image]));
  const restockRules = reorderSuggestions(forecastCats, catBreakdown);
  const clearanceRules = clearanceSuggestions(analyticsItems);
  const cleaningRules = cleaningPriority(analyticsItems, forecastCats);

  // Keep every bucket (even ₱0) so the trend reads as a continuous timeline
  // and each bar sits under its correct label. Key on the full label ("Mar 2026")
  // so months from different years never collide on the X-axis. Monthly view
  // switches the series to weekly buckets (Wk 1..5) computed server-side.
  const viewingCurrentMonth = isMonthlyView && isCurrentMonth(appliedYear, appliedMonth);
  const selectedMonthName = isMonthlyView ? SHORT_MONTHS[appliedMonth - 1] : null;
  const monthName = selectedMonthName; // label used in tooltips / empty state

  let revChart;
  let revChartEmptyLabel = 'No transaction data yet.';
  if (isMonthlyView && revByWeek && revByWeek.length > 0) {
    revChart = revByWeek.map(w => ({ label: w.label, full: `${monthName} ${appliedYear} · ${w.label}`, rev: w.revenue }));
    revChartEmptyLabel = isCurrentMonth(appliedYear, appliedMonth)
      ? 'No revenue this month yet.'
      : `No revenue in ${monthName} ${appliedYear}.`;
    if (viewingCurrentMonth) {
      // Only elapsed weeks are real — weeks that haven't started yet would
      // render as misleading zero bars ahead of the current week (and push
      // the Next Wk projection to the far end), so trim them.
      const weekIdx = Math.min(4, Math.floor((new Date().getDate() - 1) / 7));
      revChart = revChart.slice(0, weekIdx + 1);
    } else if (appliedMonth) {
      // A 28-day February has no days 29–31, so Wk 5 can never exist there.
      const daysInMonth = new Date(appliedYear, appliedMonth, 0).getDate();
      if (daysInMonth < 29) revChart = revChart.slice(0, 4);
    }
  } else {
    revChart = (revByMonth || [])
      .map(d => ({ label: d.label || shortMonth(d.label), full: d.label, rev: d.revenue }));
  }

  // Projection bar appended to the chart:
  //  - Current-month Monthly view: pace-project the REST of this month onto a
  //    "Next Wk" bar (days-left × daily pace). Past pinned months and the
  //    Yearly/Overall monthly series keep the full-month SMA->peso projection
  //    appended as next month's bar.
  if (isMonthlyView) {
    if (viewingCurrentMonth && revChart.length > 0 && thisMonthRev > 0) {
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const daysLeft = Math.max(0, Math.ceil((endOfMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const dailyPace = thisMonthRev / now.getDate();
      const projectedNextWeek = Math.round(dailyPace * Math.min(7, daysLeft));
      if (projectedNextWeek > 0)
        revChart = [...revChart, { label: 'Next Wk', full: 'Projected · next week', rev: projectedNextWeek, forecast: true }];
    }
  } else if (forecastRevValue > 0 && revChart.length > 0) {
    revChart = [...revChart, { label: monthlyNextLabel, full: monthlyNextLabel, rev: forecastRevValue, forecast: true }];
  }

  // -- Insights --
  const insights = [];
  if (popularItems.length > 0)
    insights.push(`"${popularItems[0].name}" is the most rented item (${popularItems[0].rentals}x).`);
  const highUtil = utilData.find(u => u.rate >= 80);
  if (highUtil) insights.push(`High utilisation in ${highUtil.category} (${highUtil.rate}%).`);
  if (underperforming.length > 0 && popularItems.length > 0)
    insights.push(`${underperforming.length} item(s) haven't been rented this period – consider promotions or clearance.`);
  const prevSma = mPrevSma;
  if (mLatestSma > prevSma)
    insights.push(`Next month demand forecast is ${Math.round(mLatestSma - prevSma)} rental(s) higher than this month.`);
  if (kpis?.overdueReturns > 0)
    insights.push(`${kpis.overdueReturns} overdue rental(s) need immediate attention.`);
  if (revChange > 0)
    insights.push(`Monthly revenue is up ${revChange.toFixed(0)}% compared to last month.`);
  else if (revChange < 0)
    insights.push(`Monthly revenue is down ${Math.abs(revChange).toFixed(0)}% compared to last month.`);



  // Month stepper for the revenue card (Monthly view): walk back through
  // past months or jump back to the current one. Clamped to now and 2000.
  const stepMonth = (dir) => {
    const d = new Date(appliedYear, appliedMonth - 1 + dir, 1);
    const now = new Date(now0.getFullYear(), now0.getMonth(), 1);
    if (d > now || d.getFullYear() < 2000) return;
    setSelYear(d.getFullYear());
    setSelMonth(d.getMonth() + 1);
  };
  const goCurrentMonth = () => {
    setSelYear(now0.getFullYear());
    setSelMonth(now0.getMonth() + 1);
  };

  // -- Render --
  return (    <>
      <div className="space-y-8 max-w-5xl mx-auto">

        {/* Header — title left, controls top-right on desktop; stacked on mobile */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Business Intelligence</h2>
            <p className="text-sm text-gray-500 mt-1">Real-time analytics powered by your transaction and inventory data.</p>
          </div>

          {/* Controls — single one-line row on all screens: range pills,
              optional month/year, Excel. Compact on phones, roomier on sm+. */}
          <div className="flex items-center justify-center lg:justify-end gap-2 sm:gap-3 shrink-0 w-full lg:w-auto">

            {/* Range pills — segmented control */}
            <div className="flex bg-gray-100 rounded-full p-0.5 shrink-0">
              {TIME_OPTIONS.map(t => (
                <button key={t} onClick={() => setTimeRange(t)}
                  className={`px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs font-bold rounded-full transition-colors text-center whitespace-nowrap ${timeRange === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t}
                </button>
              ))}
            </div>

            {/* Month + Year — compact pill, hidden on Overall */}
            {timeRange !== 'Overall' && (
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-full px-1.5 py-1 shrink-0">
                {timeRange === 'Monthly' && (
                  <select
                    aria-label="Month"
                    value={appliedMonth}
                    onChange={e => setSelMonth(Number(e.target.value))}
                    className="bg-transparent text-[11px] sm:text-xs font-bold text-gray-700 focus:outline-none cursor-pointer pl-0.5"
                  >
                    {SHORT_MONTHS.map((name, i) => {
                      const m = i + 1;
                      const disabledFuture = appliedYear === now0.getFullYear() && m > now0.getMonth() + 1;
                      return <option key={m} value={m} disabled={disabledFuture}>{name}</option>;
                    })}
                  </select>
                )}
                <select
                  aria-label="Year"
                  value={appliedYear}
                  onChange={e => setSelYear(Number(e.target.value))}
                  className="bg-transparent text-[11px] sm:text-xs font-bold text-gray-700 focus:outline-none cursor-pointer"
                >
                  {Array.from({ length: now0.getFullYear() - 2000 + 1 }, (_, i) => 2000 + i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="hidden sm:block w-px h-6 bg-gray-200 shrink-0" />
            <button onClick={handleWorkbookExport}
              className="shrink-0 inline-flex items-center gap-1 sm:gap-1.5 p-2 sm:px-3.5 sm:py-1.5 text-xs font-bold rounded-full bg-gray-900 text-white hover:bg-gray-700 active:scale-[0.98] transition-all"
              title={`Download Excel workbook (${workbookScopeLabel}) — Transactions, Revenue & Inventory sheets`}>
              <Download size={13} />
              <span className="hidden sm:inline">Excel</span>
            </button>
          </div>
        </div>

        {/* KPI Cards — 2-up on phones, 3-up on tablets/iPads, 6-up on desktop */}
        <div key={cacheKey} className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
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
            <p className="text-[10px] md:text-xs text-gray-500 font-medium">Pieces Rented</p>
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
            {cloneElement(analyticsData, { period: timeRange, initialData: inventoryAnalytics, onViewItemTransactions })}
          </div>
        )}

        {/* Row 1: Revenue Chart + Status Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-5 md:px-7 pt-5 md:pt-7 pb-2">
              <h3 className="font-bold text-gray-900 text-base md:text-lg">
                {isMonthlyView ? `${monthName} ${appliedYear} · Weekly Revenue` : 'Monthly Revenue'}
              </h3>
              {isMonthlyView && (
                <div className="flex items-center gap-0.5 shrink-0">
                  {!viewingCurrentMonth && (
                    <button onClick={goCurrentMonth}
                      className="px-2.5 min-h-[32px] rounded-lg text-[11px] font-bold text-[#bf4a53] hover:bg-[#bf4a53]/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                      This month
                    </button>
                  )}
                  <button onClick={() => stepMonth(-1)} aria-label="Previous month" title="Previous month"
                    className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                    <ChevronLeft size={16} />
                  </button>
                  <button onClick={() => stepMonth(1)} disabled={viewingCurrentMonth} aria-label="Next month" title="Next month"
                    className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60">
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs md:text-sm text-gray-400 px-5 md:px-7 pb-4">
              {isMonthlyView
                ? (viewingCurrentMonth ? 'Week-by-week revenue with next week projection' : 'Week-by-week revenue for the selected month')
                : 'Revenue trend with next month projection'}
            </p>
            {revChart.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-12">{revChartEmptyLabel}</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={revChart} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval={0} angle={revChart.length > 7 ? -35 : 0} textAnchor={revChart.length > 7 ? 'end' : 'middle'} height={revChart.length > 7 ? 56 : 30} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} width={52} />
                  <Tooltip content={<RevenueTooltip />} cursor={{ fill: '#f9fafb' }} />
                  <Bar dataKey="rev" name="Revenue" radius={[6, 6, 0, 0]} maxBarSize={56} minPointSize={4}>
                    {revChart.map((e, i) => (
                      <Cell key={i}
                        fill={e.rev <= 0 ? '#e5e7eb' : e.forecast ? '#bf4a53' : '#1f2937'}
                        fillOpacity={e.forecast ? 0.22 : e.rev <= 0 ? 0.5 : 1}
                        stroke={e.forecast ? '#bf4a53' : 'none'}
                        strokeWidth={e.forecast ? 2 : 0}
                        strokeDasharray={e.forecast ? '4 3' : 'none'}
                      />
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
        </div>

        {/* Row 2: Demand Forecast + Top Items */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3 px-5 md:px-7 pt-5 md:pt-7 pb-2">
              <h3 className="font-bold text-gray-900 text-base md:text-lg">Demand Forecast</h3>
              <div role="tablist" aria-label="Forecast granularity" className="flex gap-1 bg-gray-100 rounded-xl p-1 shrink-0">
                {['monthly', 'weekly'].map((g) => (
                  <button
                    key={g}
                    type="button"
                    role="tab"
                    aria-selected={granularity === g}
                    onClick={() => { setGranularity(g); if (g === 'weekly') loadWeeklyForecast(); }}
                    className={`px-3 min-h-[32px] rounded-lg text-[11px] font-bold capitalize transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf4a53]/60 ${
                      granularity === g ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs md:text-sm text-gray-400 px-5 md:px-7 pb-1">
              {weeklyLoading
                ? 'Loading weekly buckets…'
                : showingWeekly
                  ? '3‑week moving average with rental counts'
                  : '3‑month moving average with rental counts'}
            </p>
            {activeForecast?.confidenceNote && (
              <p className="px-5 md:px-7 pb-4">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${CONFIDENCE_STYLES[activeForecast.confidence] || 'bg-gray-100 text-gray-500'}`}>
                  {activeForecast.confidenceNote}
                </span>
              </p>
            )}
            {!hasSma ? (
              <div>
                <ResponsiveContainer width="100%" height={230}>
                  <ComposedChart data={countChart} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} angle={countChart.length > 7 ? -35 : 0} textAnchor={countChart.length > 7 ? 'end' : 'middle'} height={countChart.length > 7 ? 52 : 30} interval={0} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" name="Rentals" radius={[4, 4, 0, 0]} maxBarSize={56} fill="#1f2937" />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 text-center pb-4 px-7">At least {3 - validSmaCount} more {showingWeekly ? 'weeks' : 'months'} of data needed for SMA trend.</p>
              </div>
            ) : (
              <div>
                <ResponsiveContainer width="100%" height={270}>
                  <ComposedChart data={forecastData} margin={{ top: 16, right: 16, bottom: 8, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} angle={forecastData.length > 8 ? -35 : 0} textAnchor={forecastData.length > 8 ? 'end' : 'middle'} height={forecastData.length > 8 ? 52 : 30} interval={0} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const month = forecastData.find(d => d.label === label);
                        return (
                          <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm space-y-1">
                            <p className="font-bold text-gray-900">{month?.full || label}</p>
                            {payload.map((p, i) => (
                              p.value !== null && <p key={i} className="text-gray-600" style={{ color: p.color }}>
                                {p.name}: {p.name === smaName ? Number(p.value).toFixed(1) : p.value}
                              </p>
                            ))}
                            {month?.forecast && <p className="text-[11px] text-gray-400 italic">Projected</p>}
                </div>
                        );
                      }}
                    />
                    <Bar dataKey="count" name="Rentals" radius={[4, 4, 0, 0]} maxBarSize={48} fill="#1f2937" fillOpacity={0.35} />
                    <Line type="monotone" dataKey="sma" name={smaName} stroke="#bf4a53" strokeWidth={3}
                      dot={{ r: 5, fill: '#bf4a53', strokeWidth: 0 }}
                      activeDot={{ r: 8, fill: '#bf4a53', stroke: '#fff', strokeWidth: 2 }}
                      connectNulls={false}
                    />
                    {seasonDots.map((d) => (
                      <ReferenceDot key={d.full} x={d.label} y={d.count} r={5} fill="#bf4a53" stroke="#fff" strokeWidth={2} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>

                {seasonDots.length > 0 && (
                  <p className="text-[11px] text-gray-400 text-center px-7 -mt-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#bf4a53] mr-1.5" aria-hidden="true" />
                    {[...new Set(seasonDots.map((d) => SEASON_MARKERS[SHORT_MONTHS.indexOf(d.full.split(' ')[0])]))].join(' · ')}
                  </p>
                )}

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

                {/* 3-period outlook table (projected rentals + peso estimate) */}
                {projections.length > 0 && (
                  <div className="px-5 md:px-7 pb-5 md:pb-6">
                    <div className="border border-dashed border-[#bf4a53]/30 rounded-2xl overflow-hidden">
                      <p className="text-[11px] font-bold text-[#bf4a53] uppercase tracking-wide px-4 pt-3">Next 3 periods · projected</p>
                      <table className="w-full text-sm mt-1">
                        <thead>
                          <tr className="text-[11px] text-gray-400">
                            <th className="text-left font-semibold px-4 py-2">Period</th>
                            <th className="text-right font-semibold px-4 py-2">Rentals</th>
                            <th className="text-right font-semibold px-4 py-2">Est. revenue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {projections.map((p) => (
                            <tr key={p.label} className="border-t border-gray-100">
                              <td className="px-4 py-2 font-semibold text-gray-800">{p.label}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{p.value ?? '—'}</td>
                              <td className="px-4 py-2 text-right tabular-nums font-bold text-gray-900">
                                {p.value === null || p.value === undefined ? '—' : avgPriceKnown ? fmt(p.value * avgPrice) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl p-5 md:p-6 border border-gray-100/80 shadow-sm flex flex-col min-h-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
                <BarChart3 size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 text-base md:text-lg leading-tight">Top Rented Items</h3>
                <p className="text-[11px] text-gray-400 font-medium mt-0.5">Ranked by rentals this period</p>
              </div>
              {popularItems.length > 0 && (
                <span className="text-[11px] font-bold text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5 shrink-0">{popularItems.length}</span>
              )}
            </div>
            {popularItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No rentals yet.</p>
            ) : (
              <ul className="mt-3 space-y-2.5 overflow-y-auto pr-1 -mr-1 max-h-72 min-h-0">
                {popularItems.map((item) => {
                  const pct = Math.min((item.rentals / Math.max(...popularItems.map(t => t.rentals), 1)) * 100, 100);
                  // Tied rental counts share the same rank (competition ranking:
                  // rank = 1 + number of items strictly ahead).
                  const rank = popularItems.findIndex((t) => t.rentals === item.rentals) + 1;
                  return (
                    <li key={item.id} className="p-3 rounded-2xl bg-gray-50/70 border border-gray-100">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${rank === 1 ? 'bg-[#bf4a53] text-white' : 'bg-gray-200/80 text-gray-600'}`}>{rank}</span>
                        <span className="flex-1 min-w-0 text-[13px] font-semibold text-gray-800 leading-snug truncate">{item.name}</span>
                        <span className="text-xs font-bold text-gray-900 bg-white border border-gray-200 rounded-full px-2 py-0.5 shrink-0 tabular-nums">{item.rentals}x</span>
                      </div>
                      <div className="ml-9 w-[calc(100%-2.25rem)] bg-gray-200/60 rounded-full h-1.5 mt-2 overflow-hidden">
                        <div className="h-1.5 rounded-full bg-[#bf4a53]" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {underperforming.length > 0 && popularItems.length > 0 && (
              <div className="pt-2 border-t border-gray-100">
                <button type="button" onClick={() => openSmartModal('never')}
                  className="group w-full flex items-center gap-1.5 mb-2 text-left rounded-lg">
                  <p className="text-xs font-semibold text-orange-500 flex-1">{underperforming.length} item(s) never rented</p>
                  <span className="text-[11px] font-bold text-orange-600 bg-orange-50 rounded-full px-2 py-0.5">{underperforming.length}</span>
                  <ChevronRight size={13} className="text-gray-300 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
                </button>
                <div className="grid grid-cols-2 gap-1.5">
                  {underperforming.slice(0, 3).map(item => (
                    <div key={item.id} className="flex items-center gap-2 bg-orange-50 rounded-xl p-1.5 min-w-0">
                      <ItemImage image={imgById.get(item.id)} alt={item.name} thumb className="w-9 h-9 rounded-lg object-cover shrink-0" />
                      <p className="text-[11px] font-semibold text-orange-700 leading-tight line-clamp-2 min-w-0">{item.name}</p>
                    </div>
                  ))}
                  {underperforming.length > 3 && (
                    <button type="button" onClick={() => openSmartModal('never')}
                      className="flex items-center justify-center min-h-[52px] rounded-xl border border-dashed border-orange-300 text-[11px] font-bold text-orange-600 hover:bg-orange-50 active:scale-[0.98] transition-all">
                      +{underperforming.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 2b: Smart actions — deterministic rules (no AI): restock what
            demand outruns, clear what's idle, clean what's wanted next */}
        {(restockRules.length > 0 || clearanceRules.length > 0 || cleaningRules.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-3">
              <button type="button" onClick={() => restockRules.length > 0 && openSmartModal('restock')}
                disabled={restockRules.length === 0}
                className={`w-full flex items-center gap-2 text-left rounded-xl ${restockRules.length > 0 ? 'group cursor-pointer' : 'cursor-default'}`}>
                <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2 flex-1">
                  <TrendingUp size={17} className="text-emerald-600" /> Restock
                </h3>
                {restockRules.length > 0 && (
                  <>
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-0.5">{restockRules.length}</span>
                    <ChevronRight size={15} className="text-gray-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
                  </>
                )}
              </button>
              {restockRules.length === 0 ? (
                <p className="text-sm text-gray-400">Stock covers projected demand.</p>
              ) : (
                restockRules.slice(0, 4).map((r) => (
                  <div key={r.category} className="bg-emerald-50/60 rounded-2xl px-4 py-3 text-sm">
                    <p className="font-bold text-gray-900">{r.category} <span className="text-emerald-600">+{r.shortfall} pc{r.shortfall === 1 ? '' : 's'}</span></p>
                    <p className="text-xs text-gray-500 mt-0.5">Projected {r.projection}/mo · {r.freeUnits} free · {r.reason}</p>
                  </div>
                ))
              )}
              {restockRules.length > 4 && (
                <button type="button" onClick={() => openSmartModal('restock')}
                  className="w-full py-2 rounded-xl text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition-colors">
                  View all {restockRules.length}
                </button>
              )}
            </div>
            <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-3">
              <button type="button" onClick={() => clearanceRules.length > 0 && openSmartModal('clearance')}
                disabled={clearanceRules.length === 0}
                className={`w-full flex items-center gap-2 text-left rounded-xl ${clearanceRules.length > 0 ? 'group cursor-pointer' : 'cursor-default'}`}>
                <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2 flex-1">
                  <AlertTriangle size={17} className="text-orange-500" /> Clearance
                </h3>
                {clearanceRules.length > 0 && (
                  <>
                    <span className="text-[11px] font-bold text-orange-600 bg-orange-50 rounded-full px-2.5 py-0.5">{clearanceRules.length}</span>
                    <ChevronRight size={15} className="text-gray-300 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
                  </>
                )}
              </button>
              {clearanceRules.length === 0 ? (
                <p className="text-sm text-gray-400">Nothing idle — everything earns.</p>
              ) : (
                clearanceRules.slice(0, 4).map((it) => (
                  <div key={it.id} className="flex items-center gap-3 bg-orange-50/60 rounded-2xl p-3 text-sm">
                    <ItemImage image={it.image} alt={it.name} thumb className="w-10 h-10 rounded-xl object-cover shrink-0" />
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 truncate">{it.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{it.category} · {it.reason} — put on sale</p>
                    </div>
                  </div>
                ))
              )}
              {clearanceRules.length > 4 && (
                <button type="button" onClick={() => openSmartModal('clearance')}
                  className="w-full py-2 rounded-xl text-xs font-bold text-orange-600 hover:bg-orange-50 transition-colors">
                  View all {clearanceRules.length}
                </button>
              )}
            </div>
            <div className="bg-white rounded-3xl p-6 border border-gray-100/80 shadow-sm space-y-3">
              <button type="button" onClick={() => cleaningRules.length > 0 && openSmartModal('cleaning')}
                disabled={cleaningRules.length === 0}
                className={`w-full flex items-center gap-2 text-left rounded-xl ${cleaningRules.length > 0 ? 'group cursor-pointer' : 'cursor-default'}`}>
                <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2 flex-1">
                  <RotateCcw size={17} className="text-[#bf4a53]" /> Clean next
                </h3>
                {cleaningRules.length > 0 && (
                  <>
                    <span className="text-[11px] font-bold text-[#bf4a53] bg-[#bf4a53]/5 rounded-full px-2.5 py-0.5">{cleaningRules.length}</span>
                    <ChevronRight size={15} className="text-gray-300 group-hover:text-[#bf4a53] group-hover:translate-x-0.5 transition-all" />
                  </>
                )}
              </button>
              {cleaningRules.length === 0 ? (
                <p className="text-sm text-gray-400">Cleaning queue is empty.</p>
              ) : (
                cleaningRules.slice(0, 4).map((it, i) => (
                  <button key={it.id} type="button" onClick={() => openCleanQueue(it)}
                    title="Open in the cleaning queue"
                    className="w-full flex items-center gap-3 text-sm text-left rounded-xl hover:bg-gray-50 active:scale-[0.99] transition-all">
                    <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <ItemImage image={it.image} alt={it.name} thumb className="w-10 h-10 rounded-xl object-cover shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 truncate">{it.name}</p>
                      <p className="text-xs text-gray-500">{it.category}{it.demand >= 0 ? ` · demand ${it.demand}/mo` : ''}</p>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 shrink-0" />
                  </button>
                ))
              )}
              {cleaningRules.length > 4 && (
                <button type="button" onClick={() => openSmartModal('cleaning')}
                  className="w-full py-2 rounded-xl text-xs font-bold text-[#bf4a53] hover:bg-[#bf4a53]/5 transition-colors">
                  View all {cleaningRules.length}
                </button>
              )}
            </div>
          </div>
        )}

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
        </div>

        </div>

        {/* AI Report + last saved reports — one card */}
        <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm overflow-hidden">
          <div className="relative overflow-hidden bg-gradient-to-br from-[#8e323a] via-[#a63f47] to-[#bf4a53] p-4 sm:p-6">
            <div className="absolute -right-10 -top-14 w-44 h-44 rounded-full bg-white/10" />
            <div className="absolute right-16 -bottom-12 w-28 h-28 rounded-full bg-white/5" />
            <div className="relative flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-white shadow-inner shrink-0">
                  <Sparkles size={18} />
                </div>
                <h3 className="font-bold text-white text-[15px] sm:text-base leading-tight flex-1">AI Business Report</h3>
              </div>
              <p className="text-[11px] sm:text-xs text-white/75 leading-relaxed sm:flex-1 sm:min-w-0">
                A full written breakdown of revenue, demand and inventory — ready in about 30 seconds.
              </p>
              <button onClick={() => { setReportLoading(true); api.post('/ai/generate-report', undefined, { timeout: 60000 }).then(r => { setAiReport(r.report || r); setShowReportModal(true); loadRecentReports(); }).catch((err) => { setAiReport(null); alert(err?.message || 'Failed to generate AI report.'); }).finally(() => setReportLoading(false)); }}
                disabled={reportLoading}
                className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-2 px-6 py-2.5 sm:py-3 bg-white text-[#a63f47] text-sm font-bold rounded-2xl sm:rounded-full shadow-sm hover:bg-red-50 active:scale-[0.98] transition-all disabled:opacity-60"
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
      </div>

      {smartModal && (() => {
        const cfg = {
          restock: { icon: TrendingUp, iconCls: 'text-emerald-600', title: 'Restock list', sub: 'Projected demand outruns free stock' },
          clearance: { icon: AlertTriangle, iconCls: 'text-orange-500', title: 'Clearance list', sub: 'Idle pieces — put on sale (top 5)' },
          cleaning: { icon: RotateCcw, iconCls: 'text-[#bf4a53]', title: 'Cleaning order', sub: 'Clean-first order by coming demand' },
          never: { icon: AlertTriangle, iconCls: 'text-orange-500', title: 'Never rented', sub: 'Zero rentals this period — consider promotions' },
        }[smartModal];
        const Icon = cfg.icon;
        return (
          <div className={`fixed inset-0 z-[200] transition-opacity duration-150 ${smartClosing ? 'opacity-0' : 'opacity-100'}`}>
            <div className={`fixed inset-0 bg-gray-900/40 backdrop-blur-sm ${smartClosing ? 'animate-out fade-out duration-150' : 'animate-in fade-in duration-200'}`} onClick={closeSmartModal} />
            <div className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 pointer-events-none">
              <div role="dialog" aria-modal="true" className={`bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden pointer-events-auto transform-gpu ${smartClosing ? 'animate-out slide-out-to-bottom sm:zoom-out-95 fade-out duration-150' : 'animate-in slide-in-from-bottom sm:zoom-in-95 duration-200'}`} onClick={e => e.stopPropagation()}>
                <div className="shrink-0 flex items-center gap-3 p-5 sm:p-6 border-b border-gray-100/80">
                  <div className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center shrink-0">
                    <Icon size={18} className={cfg.iconCls} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-900 leading-tight">{cfg.title}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{cfg.sub}</p>
                  </div>
                  <button onClick={closeSmartModal} aria-label="Close list"
                    className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors shrink-0">
                    <X size={17} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain p-5 sm:p-6 pb-8 min-h-[220px] space-y-2.5">
                  {smartModal === 'restock' && restockRules.map((r) => (
                    <div key={r.category} className="bg-emerald-50/60 rounded-2xl px-4 py-3 text-sm">
                      <p className="font-bold text-gray-900">{r.category} <span className="text-emerald-600">+{r.shortfall} pc{r.shortfall === 1 ? '' : 's'}</span></p>
                      <p className="text-xs text-gray-500 mt-0.5">Projected {r.projection}/mo · {r.freeUnits} free · {r.reason}</p>
                    </div>
                  ))}
                  {smartModal === 'clearance' && clearanceRules.map((it) => (
                    <button key={it.id} type="button" onClick={() => setSaleTarget({ id: it.id, name: it.name })}
                      title={`Put ${it.name} on sale`}
                      className="w-full flex items-center gap-3 bg-orange-50/60 rounded-2xl p-3 text-sm text-left hover:bg-orange-50 hover:ring-1 hover:ring-orange-200 transition-all">
                      <ItemImage image={it.image} alt={it.name} thumb className="w-11 h-11 rounded-xl object-cover shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 truncate">{it.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{it.category} · {it.reason} — put on sale</p>
                      </div>
                      <Tag size={14} className="text-orange-400 shrink-0" />
                    </button>
                  ))}
                  {smartModal === 'cleaning' && cleaningRules.map((it, i) => (
                    <button key={it.id} type="button" onClick={() => openCleanQueue(it)}
                      title="Open in the cleaning queue"
                      className="w-full flex items-center gap-3 text-sm bg-gray-50/60 rounded-2xl p-3 text-left hover:bg-gray-100 hover:ring-1 hover:ring-gray-200 transition-all">
                      <span className="w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                      <ItemImage image={it.image} alt={it.name} thumb className="w-11 h-11 rounded-xl object-cover shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 truncate">{it.name}</p>
                        <p className="text-xs text-gray-500">{it.category}{it.demand >= 0 ? ` · demand ${it.demand}/mo` : ''}</p>
                      </div>
                      <ChevronRight size={14} className="text-gray-300 shrink-0" />
                    </button>
                  ))}
                  {smartModal === 'never' && underperforming.map((it) => (
                    <button key={it.id} type="button" onClick={() => setSaleTarget({ id: it.id, name: it.name })}
                      title={`Put ${it.name} on sale`}
                      className="w-full flex items-center gap-3 bg-orange-50/60 rounded-2xl p-3 text-sm text-left hover:bg-orange-50 hover:ring-1 hover:ring-orange-200 transition-all">
                      <ItemImage image={it.image || imgById.get(it.id)} alt={it.name} thumb className="w-11 h-11 rounded-xl object-cover shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 truncate">{it.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{it.category} · never rented — put on sale</p>
                      </div>
                      <Tag size={14} className="text-orange-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {showReportModal && <AIReportModal geminiReport={aiReport} onClose={() => { setShowReportModal(false); setAiReport(null); }} />}
      {saleTarget && (
        <SaleModal itemId={saleTarget.id} onClose={() => setSaleTarget(null)} />
      )}
      {cleanQueue && onBulkClean && (
        <CleaningQueueModal
          items={cleanQueueItems}
          initialSelected={cleanQueue.preselect ? [cleanQueue.preselect] : []}
          onClose={() => setCleanQueue(null)}
          onBulkClean={onBulkClean}
        />
      )}
    </>
  );
}

