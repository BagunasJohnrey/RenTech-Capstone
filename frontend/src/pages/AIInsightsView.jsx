import { useState, useEffect, useCallback, useRef, cloneElement } from 'react';
import AIReportModal from '../components/AIReportModal';
import SaleModal from '../components/SaleModal';
import CleaningQueueModal from '../components/CleaningQueueModal';
import InsightsHeader from '../components/insights/InsightsHeader';
import KpiCards from '../components/insights/KpiCards';
import RevenueChart from '../components/insights/RevenueChart';
import StatusDistribution from '../components/insights/StatusDistribution';
import DemandForecast from '../components/insights/DemandForecast';
import TopRented from '../components/insights/TopRented';
import SmartActions from '../components/insights/SmartActions';
import CategoryPerformance from '../components/insights/CategoryPerformance';
import InsightsPanel from '../components/insights/InsightsPanel';
import ReportSection from '../components/insights/ReportSection';
import SmartListModal from '../components/insights/SmartListModal';
import { extractRecommendations, shortMonth, SHORT_MONTHS, SEASON_MARKERS, STATUS_COLORS, fmt } from '../components/insights/shared';
import { api } from '../utils/api';
import { formatCheckedAgo } from '../utils/cache';
import { reorderSuggestions, clearanceSuggestions, cleaningPriority } from '../utils/optimization';
import { useToast } from '../components/Toast';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { AIInsightsSkeleton } from '../components/PageSkeletons';

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

// Snapshot age for the "Updated X ago" label under Insights (same pattern as
// Settings → Integrations / Data & Backups).
function readAiCacheAt(key) {
  const hit = aiCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > AI_CACHE_STALE_MS) return null;
  return hit.at;
}

// AI-generated promo/restock suggestions — cached in localStorage for 1 day
// (survives reloads; refresh button forces a fresh call). Deliberately not
// auto-called on every page load: Gemini is slow + costs money.
// Returns the raw { data, at } entry so callers can also show "Updated X ago".
const AI_SUGGEST_TTL_MS = 24 * 60 * 60 * 1000;
const AI_SUGGEST_KEY = 'rentech_ai_suggestions';
const aiSuggestCache = new Map();

function readAiSuggestCache() {
  const mem = aiSuggestCache.get('all');
  if (mem && Date.now() - mem.at <= AI_SUGGEST_TTL_MS) return mem;
  try {
    const raw = localStorage.getItem(AI_SUGGEST_KEY);
    if (!raw) return null;
    const { data, at } = JSON.parse(raw);
    if (Date.now() - at <= AI_SUGGEST_TTL_MS) {
      aiSuggestCache.set('all', { data, at });
      return { data, at };
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
  return at;
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
  // Years that actually have bookings (drives the year picker — no empty
  // decades). Fetched once; the applied year is always selectable regardless.
  const [availableYears, setAvailableYears] = useState(null);
  useEffect(() => {
    let active = true;
    api.get('/dashboard/years')
      .then((r) => { if (active && Array.isArray(r?.years)) setAvailableYears(r.years); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  // Manual refresh: re-runs the bundle effect below (cache-hit repaints
  // instantly AND triggers the background refresh, so this always fetches).
  const [refreshTick, setRefreshTick] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const handleRefresh = () => { setFetchError(null); setRefreshTick((t) => t + 1); };
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
  const [aiSuggestions, setAiSuggestions] = useState(() => readAiSuggestCache()?.data ?? null);
  const [suggestAt, setSuggestAt] = useState(() => readAiSuggestCache()?.at ?? null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // "Updated X ago" for the rule-based highlights: age of the bundle snapshot
  // the current insights were derived from (same pattern as Settings →
  // Integrations / Data & Backups). When AI suggestions are shown, their own
  // cache time is used instead (see updatedAt on InsightsPanel below).
  const [dataAt, setDataAt] = useState(() => readAiCacheAt(cacheKey));
  // Re-render every 30s so the "Updated X ago" label stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  // Forecast granularity: monthly comes with the bundle; weekly is fetched
  // on demand from /dashboard/forecast?granularity=weekly (admin-only).
  const [granularity, setGranularity] = useState('monthly');
  const granularityRef = useRef('monthly');
  const changeGranularity = (g) => { granularityRef.current = g; setGranularity(g); };
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
  // B2 weekly-default: when the monthly series is too thin for a trend,
  // switch to weeks once (the user can still toggle back manually).
  const autoSwitched = useRef(false);

  useEffect(() => {
    const range = timeRange;
    let active = true;
    setFetching(true);
    setFetchError(null);
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
      setDataAt(readAiCacheAt(cacheKey));
      setLoaded(true);
      setEverRendered(true);
    }
    let settled = false;
    const settle = () => { if (!settled) { settled = true; if (active) { setLoaded(true); setEverRendered(true); } } };
    const fail = (err) => {
      if (!active) return;
      setFetchError(err?.message || 'Failed to load dashboard data');
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
        // Thin monthly history → weeks carry the trend better. One-time
        // auto-switch; the toggle stays fully manual afterwards.
        if (!autoSwitched.current && granularityRef.current === 'monthly') {
          const s = (r?.forecast?.sma || []).filter(v => v !== null && v !== undefined);
          if (r?.forecast && s.length < 2) {
            autoSwitched.current = true;
            changeGranularity('weekly');
            loadWeeklyForecast();
          }
        }
        setInsightsData(r?.insights ?? null);
        setRevenueChartData(r?.insights?.revenueByMonth || []);
        setRevenueWeeklyData(r?.insights?.revenueByWeek || null);
        setInventoryAnalytics(r?.analytics ?? null);
        setAnalyticsSummary(r?.analytics?.summary ?? null);
        setDataAt(Date.now());
        setFetchError(null);
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
    }).finally(() => {
      if (active) setFetching(false);
    });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, appliedYear, appliedMonth, refreshTick]);

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

  // Full AI business report for the modal (same endpoint as suggestions,
  // longer timeout — the old 20s abort is what used to kill it mid-write).
  const handleGenerateReport = () => {
    setReportLoading(true);
    api.post('/ai/generate-report', undefined, { timeout: 60000 })
      .then(r => {
        // Provider down / rate-limited / flagged / truncated → toast instead
        // of opening the modal on a one-line error stub.
        if (r?.source === 'error') {
          toastError(r?.retryable
            ? 'AI is currently experiencing high traffic. Please try again in a moment.'
            : /flagged/.test(r.report || '')
              ? 'AI report was rejected because it invented figures. Please try again.'
              : /incomplete|truncated/.test(r.report || '')
                ? 'AI returned an incomplete report. Please try again.'
                : 'AI generation is temporarily unavailable. Try again in a few minutes.');
          return;
        }
        setAiReport(r.report || r); setShowReportModal(true); loadRecentReports();
      })
      .catch((err) => { setAiReport(null); alert(err?.message || 'Failed to generate AI report.'); })
      .finally(() => setReportLoading(false));
  };

  // On-demand AI suggestions (promo/restock recommendations) — reuses the
  // admin-only /ai/generate-report endpoint. Cached 1 day (localStorage);
  // passing force=true (Refresh AI button) always regenerates.
  const handleAiSuggest = async (force = false) => {
    if (suggestLoading) return;
    if (!force) {
      const hit = readAiSuggestCache();
      if (hit) {
        setAiSuggestions(hit.data);
        setSuggestAt(hit.at);
        return;
      }
    }
    setSuggestLoading(true);
    try {
      const r = await api.post('/ai/generate-report', undefined, { timeout: 60000 });
      // Provider down / rate-limited / hallucination-flagged / truncated →
      // keep static insights and say so plainly, instead of a confusing
      // format error.
      if (r?.source === 'error') {
        setAiSuggestions(null);
        toastError(r?.retryable
          ? 'AI is currently experiencing high traffic — showing static insights. Please try again in a moment.'
          : /flagged/.test(r.report || '')
            ? 'AI report was rejected because it invented figures — showing static insights.'
            : /incomplete|truncated/.test(r.report || '')
              ? 'AI returned an incomplete report — showing static insights. Please try again.'
              : 'AI generation is temporarily unavailable. Showing static insights — try again in a few minutes.');
        return;
      }
      const suggestions = extractRecommendations(r.report || r);
      if (suggestions.length === 0) {
        toastError('AI report came back in an unexpected format — showing static insights.');
        setAiSuggestions(null);
        return;
      }
      setSuggestAt(writeAiSuggestCache(suggestions));
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
  // Overall answers "all time": show lifetime collected with no comparison
  // badge. Windowed tabs show the window's collected vs the previous window.
  const isOverallView = timeRange === 'Overall';
  const displayRev = isOverallView ? (kpis?.totalRevenue || 0) : thisMonthRev;
  const displayPrev = isOverallView ? 0 : prevMonthRev;
  const revChange = prevMonthRev > 0 ? ((thisMonthRev - prevMonthRev) / prevMonthRev) * 100 : 0;
  // The revenue KPI follows the active tab (the backend already scopes the
  // figure to the window) — so the label must follow it too instead of always
  // reading "Monthly Revenue".
  const revMonLabel = `${SHORT_MONTHS[(appliedMonth ?? now0.getMonth() + 1) - 1]} ${appliedYear ?? now0.getFullYear()}`;
  const revLabel = timeRange === 'Yearly' ? `${appliedYear} Revenue`
    : timeRange === 'Monthly' ? `${revMonLabel} Revenue`
    : 'Total Revenue';
  const revSub = timeRange === 'Yearly' ? `Collected Jan–Dec ${appliedYear}`
    : timeRange === 'Monthly' ? `Collected ${revMonLabel}`
    : 'All-time collected';
  // Short "vs" label for the change pill (null = no comparison shown).
  // Monthly walks back one month (Jan wraps to last Dec).
  const revVsLabel = timeRange === 'Yearly' ? `vs ${appliedYear - 1}`
    : timeRange === 'Monthly'
      ? (() => {
          const d = new Date(appliedYear, (appliedMonth ?? now0.getMonth() + 1) - 2, 1);
          return `vs ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        })()
      : null;
  const revCompare = timeRange === 'Yearly' ? 'the previous year' : 'last month';
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
  const smaName = 'Average trend';

  // -- Revenue projection math stays monthly no matter the toggle: weekly
  // rental counts must never divide a full month's revenue.
  const mCounts = forecast?.counts || [];
  const mSmaVals = (forecast?.sma || []).filter(v => v !== null && v !== undefined);
  const mLatestSma = mSmaVals.length > 0 ? mSmaVals[mSmaVals.length - 1] : 0;
  const mPrevSma = mSmaVals.length >= 2 ? mSmaVals[mSmaVals.length - 2] : 0;
  // Average ticket: last month's revenue ÷ its bookings — but a stale/empty
  // series (or a genuinely zero month) must not zero every projection
  // forever. Fall back to the window average (same scope top and bottom),
  // and only then admit the price is unknown.
  const lastRev = revByMonth.length > 0 ? (revByMonth[revByMonth.length - 1]?.revenue || 0) : 0;
  const lastCount = mCounts.length > 0 ? mCounts[mCounts.length - 1] : 0;
  const summaryRev = analyticsSummary?.totalRevenue || 0;
  const summaryRentals = analyticsSummary?.totalRentals || 0;
  const avgPriceKnown = (lastCount > 0 && lastRev > 0) || (summaryRentals > 0 && summaryRev > 0);
  const avgPrice = (lastCount > 0 && lastRev > 0)
    ? lastRev / lastCount
    : (summaryRentals > 0 && summaryRev > 0 ? summaryRev / summaryRentals : 1500);
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

  // Spike flags → human rows ("May 2026: bulk booking — excluded from the
  // average"), resolved against the active series' labels.
  const spikeNotes = (activeForecast?.flags || [])
    .map((f) => ({ ...(fLabels[f.index] ? { label: fLabels[f.index] } : {}), reason: f.reason }))
    .filter((f) => f.label);
  const forecastErrorPct = activeForecast?.errorPct ?? null;
  const forecastProvisional = !!activeForecast?.provisional;

  // -- Chart data (weekly labels shown in full — shortMonth would
  // collapse every week of a month onto one tick). bandLo/bandSpan stack
  // into the shaded expected-range polygon behind the trend line.
  const bandLo = activeForecast?.band?.lo || [];
  const bandHi = activeForecast?.band?.hi || [];
  // X-axis ticks must be UNIQUE: recharts matches duplicate categories by
  // label, so two bare "Apr" ticks (2025 vs 2026) make every hover resolve to
  // the first match — April 2026 kept showing April 2025's numbers no matter
  // what the tooltip read. Every monthly tick carries its year instead.
  const shortMonthYear = (l) => {
    const parts = String(l || '').split(' ');
    if (!parts[0]) return '';
    if (parts[1]) return `${parts[0]} ’${parts[1].slice(2)}`;
    return parts[0];
  };
  const forecastData = fLabels.map((l, i) => ({
    label: showingWeekly ? l : shortMonthYear(l),
    full: l,
    count: fCounts[i] || 0,
    sma: fSma[i] ?? null,
    bandLo: bandLo[i] ?? null,
    bandSpan: bandLo[i] == null || bandHi[i] == null ? null : Math.max(0, Math.round((bandHi[i] - bandLo[i]) * 100) / 100),
  }));
  forecastData.push({
    label: showingWeekly ? nextLabel : shortMonthYear(nextLabel),
    full: nextLabel,
    count: null,
    sma: latestSmaVal,
    forecast: true,
    // Carry the band forward so the shaded range reaches the projection
    // point too — otherwise the ribbon visibly stops one tick early.
    ...(latestSmaVal !== null && latestSmaVal !== undefined && forecastErrorPct !== null && forecastErrorPct !== undefined
      ? {
          bandLo: Math.max(0, Math.round(latestSmaVal * (1 - forecastErrorPct / 100) * 100) / 100),
          bandSpan: Math.round(latestSmaVal * (2 * forecastErrorPct / 100) * 100) / 100,
        }
      : { bandLo: null, bandSpan: null }),
  });
  const validSmaCount = forecastData.filter(d => d.sma !== null && !d.forecast).length;
  const hasSma = validSmaCount >= 2;
  const countChart = fLabels.map(l => ({ label: shortMonthYear(l), full: l, count: fCounts[fLabels.indexOf(l)] || 0 }));

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
      // the Next Wk projection to the far end), so trim them. The last kept
      // week is still in progress: mark it so the chart renders it lighter,
      // labels it, and never compares it 1:1 in deltas.
      const weekIdx = Math.min(4, Math.floor((new Date().getDate() - 1) / 7));
      revChart = revChart.slice(0, weekIdx + 1);
      if (revChart.length > 0) revChart[revChart.length - 1] = { ...revChart[revChart.length - 1], wip: true };
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
  // Blended Next Wk (C1): 0.5 × this month's daily pace + 0.5 × weekly-trend
  // demand (weekly SMA × average ticket). The demand half needs the weekly
  // forecast (fetched when the card toggles to weeks); without it the bar is
  // pace-only rather than guessed. Range whisker = ±1 sample stddev of the
  // last 4 COMPLETED weeks (hidden with < 2). At month-end there is no pace
  // left, so the bar becomes the full trend projection — never hidden (C2).
  const sampleStd = (xs) => {
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
  };
  let revFootnote = null;
  if (isMonthlyView) {
    if (viewingCurrentMonth && revChart.length > 0 && thisMonthRev > 0) {
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const daysLeft = Math.max(0, Math.ceil((endOfMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const completedWeeks = revChart.filter(e => !e.forecast && !e.wip && e.rev > 0).slice(-4).map(e => e.rev);
      const whiskerOf = (v) => {
        if (completedWeeks.length < 2) return null;
        const sd = sampleStd(completedWeeks);
        if (!(sd > 0)) return null;
        return [Math.max(0, Math.round(v - sd)), Math.round(v + sd)];
      };
      if (daysLeft > 0) {
        const dailyPace = thisMonthRev / now.getDate();
        const paceRest = Math.round(dailyPace * Math.min(7, daysLeft));
        const wSma = ((weeklyForecast?.sma || []).filter(v => v !== null && v !== undefined));
        const wLatest = wSma.length > 0 ? wSma[wSma.length - 1] : null;
        const demand = (wLatest !== null && avgPriceKnown) ? Math.round(wLatest * avgPrice) : null;
        const blended = demand !== null ? Math.round(0.5 * paceRest + 0.5 * demand) : paceRest;
        if (blended > 0) {
          const whisker = whiskerOf(blended);
          revChart = [...revChart, {
            label: 'Next Wk', full: 'Projected · next week', rev: blended, forecast: true,
            ...(whisker ? { whisker } : {}),
          }];
          revFootnote = demand !== null
            ? `Next week blends this month's daily pace with the rental trend × ${fmt(avgPrice)} average ticket.`
            : null;
        }
      } else if (avgPriceKnown && forecastRevValue > 0) {
        // Month-end: pace is zero by definition — project next month's first
        // week from the trend instead of hiding the bar. Weekly-scale share
        // of the monthly peso projection (A1: skipped when price unknown).
        const wkShare = Math.round(forecastRevValue / 4.33);
        if (wkShare > 0) {
          const whisker = whiskerOf(wkShare);
          revChart = [...revChart, {
            label: 'Next Wk', full: 'Projected · next month week 1', rev: wkShare, forecast: true,
            ...(whisker ? { whisker } : {}),
          }];
        }
      }
    }
  // A1 unit-mix guard: forecastRevValue is a rental COUNT when the average
  // ticket is unknown (avg price falls back to a hard-coded 1500), so it must
  // never render as a peso bar. The outlook table already shows '—' there.
  } else if (avgPriceKnown && forecastRevValue > 0 && revChart.length > 0) {
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
    insights.push(`Revenue is up ${revChange.toFixed(0)}% compared to ${revCompare}.`);
  else if (revChange < 0)
    insights.push(`Revenue is down ${Math.abs(revChange).toFixed(0)}% compared to ${revCompare}.`);



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
      <div className="space-y-8 max-w-lg mx-auto md:max-w-3xl lg:max-w-[1200px]">

        <InsightsHeader
          timeRange={timeRange} setTimeRange={setTimeRange}
          appliedMonth={appliedMonth} appliedYear={appliedYear}
          setSelMonth={setSelMonth} setSelYear={setSelYear} now0={now0}
          availableYears={availableYears}
          refreshState={fetching ? 'loading' : fetchError ? 'error' : 'idle'}
          onRefresh={handleRefresh}
          statusText={fetching ? 'Refreshing…' : fetchError ? 'Failed to load — tap ⟳ to retry' : dataAt ? `Updated ${formatCheckedAgo(dataAt)}` : ''}
          workbookScopeLabel={workbookScopeLabel} handleWorkbookExport={handleWorkbookExport}
        />

        {/* KPI Cards — 2-up on phones, 3-up on tablets/iPads, 6-up on desktop */}
        <div key={cacheKey} className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <KpiCards
          thisMonthRev={displayRev} prevMonthRev={displayPrev} revChange={revChange}
          revLabel={revLabel} revSub={revSub} revVsLabel={revVsLabel}
          rentedCount={rentedCount} totalItems={totalItems}
          smaVals={smaVals} latestSmaVal={latestSmaVal} forecastRev={forecastRev}
          avgPriceKnown={avgPriceKnown}
          analyticsSummary={analyticsSummary}
        />

        {analyticsData && (
          <div className="bg-white rounded-3xl border border-gray-100/80 shadow-sm overflow-hidden">
            {cloneElement(analyticsData, { period: timeRange, initialData: inventoryAnalytics, onViewItemTransactions })}
          </div>
        )}

        {/* Row 1: Revenue Chart + Status Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <RevenueChart
            isMonthlyView={isMonthlyView} monthName={monthName}
            appliedYear={appliedYear} appliedMonth={appliedMonth}
            viewingCurrentMonth={viewingCurrentMonth}
            revChart={revChart} revChartEmptyLabel={revChartEmptyLabel}
            revFootnote={revFootnote}
            stepMonth={stepMonth} goCurrentMonth={goCurrentMonth}
          />
          <StatusDistribution
            totalTx={totalTx} statusDist={statusDist}
            activePie={activePie} setActivePie={setActivePie}
          />
        </div>

        {/* Row 2: Demand Forecast + Top Items */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <DemandForecast
            granularity={granularity} setGranularity={changeGranularity}
            loadWeeklyForecast={loadWeeklyForecast} weeklyLoading={weeklyLoading}
            showingWeekly={showingWeekly} activeForecast={activeForecast}
            hasSma={hasSma} countChart={countChart} validSmaCount={validSmaCount}
            forecastData={forecastData} latestSmaVal={latestSmaVal} prevSmaVal={prevSmaVal}
            smaTrend={smaTrend} smaName={smaName} seasonDots={seasonDots}
            projections={projections} avgPriceKnown={avgPriceKnown} avgPrice={avgPrice}
            spikeNotes={spikeNotes} forecastProvisional={forecastProvisional} forecastErrorPct={forecastErrorPct}
          />
          <TopRented
            popularItems={popularItems} underperforming={underperforming}
            imgById={imgById} openSmartModal={openSmartModal}
          />
        </div>

        {/* Row 2b: Smart actions — deterministic rules (no AI): restock what
            demand outruns, clear what's idle, clean what's wanted next */}
        {(restockRules.length > 0 || clearanceRules.length > 0 || cleaningRules.length > 0) && (
          <SmartActions
            restockRules={restockRules} clearanceRules={clearanceRules} cleaningRules={cleaningRules}
            openSmartModal={openSmartModal} openCleanQueue={openCleanQueue}
          />
        )}

        {/* Row 3: Category Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <CategoryPerformance utilData={utilData} />
          <InsightsPanel
            role={role} aiSuggestions={aiSuggestions} suggestLoading={suggestLoading}
            handleAiSuggest={handleAiSuggest} insights={insights}
            updatedAt={aiSuggestions?.length ? suggestAt : dataAt}
          />
        </div>

        </div>

        <ReportSection
          role={role} reportLoading={reportLoading} onGenerate={handleGenerateReport}
          recentReports={recentReports} reportsLoading={reportsLoading}
          reportsPage={reportsPage} REPORTS_PAGE_SIZE={REPORTS_PAGE_SIZE} setReportsPage={setReportsPage}
          openSavedReport={openSavedReport} openingReportId={openingReportId}
        />

        <SmartListModal
          smartModal={smartModal} smartClosing={smartClosing} closeSmartModal={closeSmartModal}
          restockRules={restockRules} clearanceRules={clearanceRules} cleaningRules={cleaningRules}
          underperforming={underperforming} imgById={imgById}
          onSaleItem={(it) => setSaleTarget({ id: it.id, name: it.name })}
          openCleanQueue={openCleanQueue}
        />
      </div>

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

