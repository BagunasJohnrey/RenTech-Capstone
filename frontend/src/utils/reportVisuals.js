/**
 * Pulls chartable figures back out of the AI report text so the modal and the
 * PDF can show visuals next to the prose. The numbers are read from the report
 * itself (which the server has already checked against the database), so saved
 * reports reopened from history get the same charts with no extra fetch.
 *
 * Every extractor is forgiving: if the model phrased a section differently
 * and fewer than two data points come back, that chart is just left out.
 */

// "₱42,900", "₱60.3K", "PHP 1.2M" -> number
export function parseMoney(s) {
  const m = /(?:₱|PHP\s?)\s*([\d,]+(?:\.\d+)?)\s*([KkMm])?/.exec(s || '');
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  if (m[2]) n *= /k/i.test(m[2]) ? 1e3 : 1e6;
  return n;
}

function parseNumber(s) {
  const m = /-?[\d,]+(?:\.\d+)?/.exec(s || '');
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

function findSection(sections, title) {
  const t = norm(title);
  return sections.find((s) => norm(s.title).startsWith(t));
}

// "Label: value" lines -> { 'monthly revenue': '₱42,900', ... }
function readKeyValues(lines) {
  const out = {};
  for (const line of lines) {
    const m = /^([A-Za-z][A-Za-z '’-]{2,40}):\s*(.+)$/.exec(line.trim());
    if (m) out[norm(m[1])] = m[2].trim();
  }
  return out;
}

const pick = (kv, ...keys) => {
  for (const k of keys) if (kv[k] != null) return kv[k];
  return null;
};

function extractKpis(sections) {
  const lines = sections.flatMap((s) => s.bodyLines);
  const kv = readKeyValues(lines);
  const money = (...k) => parseMoney(pick(kv, ...k));
  const num = (...k) => parseNumber(pick(kv, ...k));

  const k = {
    monthlyRevenue: money('monthly revenue'),
    prevRevenue: money('previous month revenue'),
    totalRevenue: money('total revenue'),
    utilization: num('utilization rate'),
    overdueRate: num('overdue rate'),
    overdue: num('overdue returns', 'overdue'),
    active: num('active rentals'),
    returned: num('returned count', 'returned'),
    cancelled: num('cancelled count', 'cancelled'),
    totalItems: num('total items'),
    available: num('available items'),
    inUse: num('in use items'),
  };

  const tiles = [];
  if (k.monthlyRevenue != null) {
    let delta = null;
    if (k.prevRevenue) delta = ((k.monthlyRevenue - k.prevRevenue) / k.prevRevenue) * 100;
    tiles.push({
      label: 'Monthly revenue',
      value: k.monthlyRevenue,
      format: 'money',
      delta,
      sub: k.prevRevenue != null ? `vs ${formatMoney(k.prevRevenue)} last month` : null,
    });
  }
  if (k.utilization != null) {
    tiles.push({ label: 'Utilization', value: k.utilization, format: 'pct', meter: k.utilization });
  }
  if (k.overdue != null) {
    tiles.push({
      label: 'Overdue returns',
      value: k.overdue,
      format: 'count',
      sub: k.overdueRate != null ? `${k.overdueRate}% overdue rate` : null,
      tone: k.overdue > 0 ? 'critical' : null,
    });
  }
  if (k.totalRevenue != null) {
    const period = pick(kv, 'revenue period');
    const inApp = money('collected in app');
    const when = period
      ? (/all time/i.test(period) ? 'all time' : period.replace(/^year\s*/i, ''))
      : 'all time';
    tiles.push({
      label: 'Total revenue',
      value: k.totalRevenue,
      format: 'money',
      sub: inApp != null ? `${when} · app + logbook` : when,
    });
  }

  const status = [
    { label: 'Returned', value: k.returned, tone: 'good' },
    { label: 'Active', value: k.active, tone: 'info' },
    { label: 'Overdue', value: k.overdue, tone: 'critical' },
    { label: 'Cancelled', value: k.cancelled, tone: 'muted' },
  ].filter((s) => s.value != null);
  const statusTotal = status.reduce((a, s) => a + s.value, 0);

  let stock = null;
  if (k.totalItems && k.available != null) {
    const inUse = k.inUse != null ? k.inUse : k.totalItems - k.available;
    stock = { total: k.totalItems, available: k.available, inUse };
  }

  return {
    tiles: tiles.length >= 2 ? tiles : [],
    status: status.length >= 2 && statusTotal > 0 ? status : [],
    stock,
  };
}

function extractRevenueByCategory(section) {
  if (!section) return [];
  const out = [];
  const seen = new Set();
  const text = section.bodyLines.join('\n');
  // "Gown generated ₱361,400" and "Gown: ₱361,400"
  const re = /([A-Z][A-Za-z&' ]{1,24}?)(?:\s+generated|:)\s+((?:₱|PHP\s?)\s*[\d,]+(?:\.\d+)?\s*[KkMm]?)/g;
  let m;
  while ((m = re.exec(text))) {
    const label = m[1].replace(/^(and|or)\s+/i, '').trim();
    const key = label.toLowerCase();
    if (/revenue|total|month|today/.test(key) || seen.has(key)) continue;
    const value = parseMoney(m[2]);
    if (value == null) continue;
    seen.add(key);
    out.push({ label, value });
  }
  return out.length >= 2 ? out.sort((a, b) => b.value - a.value) : [];
}

function extractCategoryBreakdown(section) {
  if (!section) return [];
  const out = [];
  for (const line of section.bodyLines) {
    const m = /^([A-Za-z][\w &'()?-]{0,30}?):\s*(\d+)\s*total,\s*(\d+)\s*rented/i.exec(line.trim());
    if (m) out.push({ label: m[1].trim(), total: +m[2], rented: +m[3] });
  }
  return out.length >= 2 ? out : [];
}

function extractTopItems(sections) {
  for (const s of sections) {
    for (const line of s.bodyLines) {
      if (!/most[- ]rented|top rented/i.test(line)) continue;
      const out = [];
      const re = /([^,:]+?)\s*\((\d+)\s*rentals?\)/gi;
      let m;
      while ((m = re.exec(line))) {
        out.push({ label: m[1].replace(/^\s*(and|or)\s+/i, '').trim(), value: +m[2] });
      }
      if (out.length >= 2) return out.sort((a, b) => b.value - a.value).slice(0, 6);
    }
  }
  return [];
}

function extractProjections(section) {
  if (!section) return [];
  const out = [];
  for (const line of section.bodyLines) {
    const m = /^([A-Za-z][\w &'()?-]{0,30}?):\s*projected\s*([\d.]+)[^,]*,?\s*(?:trend\s*(?:is)?\s*)?(up|down|flat|rising|falling|stable)?/i.exec(line.trim());
    if (!m) continue;
    const t = (m[3] || '').toLowerCase();
    const trend = /up|rising/.test(t) ? 'up' : /down|falling/.test(t) ? 'down' : 'flat';
    out.push({ label: m[1].trim(), value: parseFloat(m[2]), trend });
  }
  // A zero/flat placeholder row (e.g. a mislabeled category) adds nothing.
  const real = out.filter((p) => p.value > 0);
  return real.length >= 2 ? real.sort((a, b) => b.value - a.value) : [];
}

// ---- Visuals from the server's report facts --------------------------------
// New reports carry `facts`: the exact figures the model was given. Tiles,
// charts and tables are drawn from those, so the AI's phrasing ("Gown with
// ₱91.7K", "₱3,786.5K") can never drop a category or round an amount. Old
// saved reports have no facts and fall back to reading the text (below).

const periodLabel = (p) => (!p || /all time/i.test(p) ? 'all time' : String(p).replace(/^year\s*/i, ''));

function visualsFromFacts(f) {
  const k = f.kpis || {};
  const delta = k.prevMonthRevenue ? ((k.monthlyRevenue - k.prevMonthRevenue) / k.prevMonthRevenue) * 100 : null;
  const tiles = [
    {
      label: 'Monthly revenue',
      value: k.monthlyRevenue,
      format: 'money',
      delta,
      sub: `vs ${formatMoney(k.prevMonthRevenue)} last month · in-app`,
    },
    { label: 'Utilization', value: k.utilizationRate, format: 'pct', meter: k.utilizationRate },
    {
      label: 'Overdue returns',
      value: k.overdueReturns,
      format: 'count',
      // Same definition as the dashboard: overdue ÷ (overdue + returned).
      sub: `${k.overdueRate}% of rentals due back`,
      tone: k.overdueReturns > 0 ? 'critical' : null,
    },
    {
      label: 'Total revenue',
      value: k.totalRevenue,
      format: 'money',
      sub: `${periodLabel(k.revenuePeriod)} · app + logbook`,
    },
  ];
  const status = [
    { label: 'Returned', value: k.returnedCount, tone: 'good' },
    { label: 'Active', value: k.activeRentals, tone: 'info' },
    { label: 'Overdue', value: k.overdueReturns, tone: 'critical' },
    { label: 'Cancelled', value: k.cancelledCount, tone: 'muted' },
  ];
  const statusTotal = status.reduce((a, x) => a + (x.value || 0), 0);
  // Only figures the tiles and the status chart above don't already show.
  const kpiRows = [
    ['Previous month revenue (in-app)', formatMoney(k.prevMonthRevenue)],
    ["Today's revenue", formatMoney(k.todayRevenue)],
    [`Total revenue — collected in app`, formatMoney(k.collectedInApp)],
    [`Total revenue — logbook records`, formatMoney(k.logbookRevenue)],
    ['Damaged items', String(k.damagedItems)],
    ['Cancellation rate', `${k.cancellationRate}%`],
  ];
  return {
    'key performance indicators': {
      tiles,
      status: statusTotal > 0 ? status : [],
      kpiRows,
    },
    'revenue analysis': {
      revenueByCategory: f.revenueByCategory || [],
    },
    'inventory utilization': {
      stock: k.totalItems ? { total: k.totalItems, available: k.availableItems, inUse: k.inUseItems } : null,
      categoryBreakdown: (f.categoryStock || []).map((r) => ({ label: r.label, total: r.total, rented: r.inUse })),
      breakdownLive: true,
      topItems: f.topItems || [],
    },
    'demand forecast': {
      projections: f.categoryProjections || [],
    },
  };
}

/**
 * @param {{title: string, bodyLines: string[]}[]} sections from parseReportSections
 * @param {object} [facts] the server's report facts (new reports); preferred over the text
 * @returns {Record<string, object>} visuals keyed by the section they belong to
 */
export function extractReportVisuals(sections, facts) {
  if (facts && facts.version && facts.kpis) {
    const v = visualsFromFacts(facts);
    v.__facts = true;
    return v;
  }
  if (!Array.isArray(sections) || !sections.length) return {};
  const kpis = extractKpis(sections);
  const visuals = {
    'key performance indicators': {
      tiles: kpis.tiles,
      status: kpis.status,
    },
    'revenue analysis': {
      revenueByCategory: extractRevenueByCategory(findSection(sections, 'Revenue Analysis')),
    },
    'inventory utilization': {
      stock: kpis.stock,
      categoryBreakdown: extractCategoryBreakdown(findSection(sections, 'Inventory & Utilization')),
      topItems: extractTopItems(sections),
    },
    'demand forecast': {
      projections: extractProjections(findSection(sections, 'Demand Forecast')),
    },
  };
  return visuals;
}

// Look up the visuals for a section title ("Inventory & Utilization" etc.).
export function visualsFor(visuals, title) {
  const v = visuals?.[norm(title)];
  if (!v) return null;
  const has = Object.values(v).some((x) => (Array.isArray(x) ? x.length : !!x));
  return has ? v : null;
}

// Report prices always carry 2 decimals (₱1,234.00).
export function formatMoney(n) {
  return `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "₱22,450" / "PHP 22,450.5" written by the AI -> "₱22,450.50". Anything that
// isn't a plain peso amount is returned unchanged.
export function normalizeMoneyText(value) {
  const m = /^(?:₱|PHP|Php)\s?([\d,]+(?:\.\d+)?)$/.exec(String(value).trim());
  return m ? formatMoney(Number(m[1].replace(/,/g, ''))) : value;
}

export function formatCompactMoney(n) {
  if (n >= 1e6) return `₱${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `₱${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return `₱${Math.round(n)}`;
}

export const TONE_COLORS = {
  good: '#059669',
  info: '#2563eb',
  critical: '#dc2626',
  muted: '#9ca3af',
};

// ---- Tables + prose -------------------------------------------------------
// Each section is laid out as: charts, then a table of its figures, then the
// remaining sentences as paragraphs. Lines that a table fully restates are
// dropped from the prose so nothing reads twice.

const KV_LINE = /^([A-Za-z][A-Za-z '’-]{2,40}):\s*(.+)$/;
const BREAKDOWN_LINE = /^([A-Za-z][\w &'()?-]{0,30}?):\s*(\d+)\s*total,\s*(\d+)\s*rented\.?$/i;
const PROJECTION_LINE = /^([A-Za-z][\w &'()?-]{0,30}?):\s*projected\s*([\d.]+)[^,]*,?\s*(?:trend\s*(?:is)?\s*)?(up|down|flat|rising|falling|stable)?\.?$/i;
// Also matches qualified headings like "Category breakdown (total, rented at least once):".
const LIST_INTRO = /^(category breakdown|category projections|revenue by category|top rented items|most[- ]rented items)\b[^.]*:?\s*$/i;
// "Royal Sapphire Debut Gown (Gown): 3 rentals" — one item per line.
const ITEM_COUNT_LINE = /^[^:]{2,80}:\s*\d+\s*rentals?\.?$/i;
// Any short "Label: value" fact, even with parentheses in the label.
const SHORT_FACT_LINE = /^[^:]{2,70}:\s*\S+(?:\s+\S+){0,3}$/;

// A short "Label: value" fact (a number, percent or peso amount), not a sentence.
function isMetricLine(line) {
  const m = KV_LINE.exec(line.trim());
  if (!m) return null;
  const value = m[2].trim().replace(/\.$/, '');
  if (!/\d/.test(value) || value.split(/\s+/).length > 4) return null;
  return { label: m[1].trim(), value: normalizeMoneyText(value) };
}

const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const TREND_WORD = { up: 'Rising', down: 'Falling', flat: 'Flat' };

export function layoutSection(section, visuals) {
  const v = visualsFor(visuals, section.title) || {};
  const fromFacts = !!visuals?.__facts;
  const tables = [];
  const paragraphs = [];
  const metrics = [];
  const breakdown = [];
  const projections = [];

  for (const raw of section.bodyLines) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = BREAKDOWN_LINE.exec(line))) {
      if (!fromFacts) breakdown.push({ label: m[1].trim(), total: +m[2], rented: +m[3] });
    } else if ((m = PROJECTION_LINE.exec(line))) {
      if (fromFacts) continue;
      const t = (m[3] || '').toLowerCase();
      projections.push({
        label: m[1].trim(),
        value: parseFloat(m[2]),
        trend: /up|rising/.test(t) ? 'up' : /down|falling/.test(t) ? 'down' : 'flat',
      });
    } else if (fromFacts && /^collected in app\b/i.test(line)) {
      // The app/logbook split is in the Figures table already.
    } else if (fromFacts && v.kpiRows && SHORT_FACT_LINE.test(line)) {
      // e.g. "Monthly revenue (November 2026): ₱30.6K" — the tiles and the
      // Figures table carry the exact amount.
    } else if (fromFacts && /^[^:]{1,40}:\s*\d+\s*total,\s*\d+\s*rented\b/i.test(line)) {
      // "Gown: 45 total, 24 rented (at least once this period)" — the
      // Category breakdown table shows live in-use counts instead.
    } else if (fromFacts && v.projections?.length && /^[^:]{0,60}\bprojections?\b[^:]{0,30}:/i.test(line)) {
      // "Gown category projection: 66.7 (from latest 4)" — the Category
      // projections table shows each category with its trend.
    } else if (fromFacts && v.topItems?.length && /^(top|most)[-\u2011 ]rented items\b.*\d+\s*rentals?/i.test(line)) {
      // "Top rented items include: X (Gown) with 4 rentals, …" — same as the chart.
    } else if (fromFacts && ITEM_COUNT_LINE.test(line)) {
      // Per-item rental counts — the Most-rented chart shows them exactly.
    } else if (LIST_INTRO.test(line)) {
      // "Category breakdown:" heading — the table below carries it.
    } else if (/^revenue by category\b/i.test(line) && v.revenueByCategory?.length) {
      // Restated by the revenue table.
    } else if (/most[- ]rented|top rented/i.test(line) && /\(\d+\s*rentals?\)/i.test(line) && v.topItems?.length) {
      // Restated by the most-rented table.
    } else if ((m = isMetricLine(line))) {
      // KPI figures come from the facts table; the AI's copy (often rounded
      // to ₱30.6K) would only restate them less precisely.
      if (!(fromFacts && v.kpiRows)) metrics.push(m);
    } else {
      paragraphs.push(line);
    }
  }

  // An intro ending in ":" whose list was removed above (its items are in a
  // table) would dangle at the end of the section — drop it.
  // Also drop one followed by an ordinary sentence (its list is gone); keep
  // one followed by list lines like "Zebra Trim Filipiniana Set (Filipiniana)".
  if (fromFacts) {
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      if (!/:\s*$/.test(paragraphs[i])) continue;
      const next = paragraphs[i + 1];
      if (next === undefined || /[.!?]$/.test(next.trim())) paragraphs.splice(i, 1);
    }
  }

  if (fromFacts && v.kpiRows) {
    tables.push({ title: 'Figures', columns: ['Metric', 'Value'], align: ['left', 'right'], rows: v.kpiRows });
  }
  if (fromFacts && v.categoryBreakdown?.length) {
    breakdown.push(...v.categoryBreakdown);
  }
  if (fromFacts && v.projections?.length) {
    projections.push(...v.projections);
  }
  if (metrics.length >= 2) {
    tables.push({ title: 'Figures', columns: ['Metric', 'Value'], align: ['left', 'right'], rows: metrics.map((x) => [x.label, x.value]) });
  } else {
    // A lone "Label: value" reads fine as a sentence.
    for (const x of metrics) paragraphs.unshift(`${x.label}: ${x.value}`);
  }

  if (v.revenueByCategory?.length) {
    const total = v.revenueByCategory.reduce((a, r) => a + r.value, 0);
    tables.push({
      title: fromFacts ? 'Revenue figures (in-app payments)' : 'Revenue figures',
      columns: ['Category', 'Revenue', 'Share'],
      align: ['left', 'right', 'right'],
      rows: v.revenueByCategory.map((r) => [r.label, formatMoney(r.value), pct(r.value, total)]),
    });
  }
  if (breakdown.length) {
    tables.push({
      title: 'Category breakdown',
      columns: fromFacts
        ? ['Category', 'Total units', 'In use now', '% in use']
        : ['Category', 'Total units', 'Rented', '% rented'],
      align: ['left', 'right', 'right', 'right'],
      rows: breakdown.map((r) => [r.label, String(r.total), String(r.rented), pct(r.rented, r.total)]),
    });
  }
  // With facts, the most-rented chart already shows every count exactly, so a
  // table of the same rows would only repeat it.
  if (v.topItems?.length && !fromFacts) {
    tables.push({
      title: 'Rental counts',
      columns: ['Item', 'Rentals'],
      align: ['left', 'right'],
      rows: v.topItems.map((r) => [r.label, String(r.value)]),
    });
  }
  if (projections.length) {
    tables.push({
      title: 'Category projections',
      columns: ['Category', 'Projected / month', 'Trend'],
      align: ['left', 'right', 'right'],
      rows: projections.map((r) => [r.label, Number.isInteger(r.value) ? String(r.value) : r.value.toFixed(1), TREND_WORD[r.trend]]),
    });
  }

  // House style regardless of which AI wrote it: sentences (and numbered
  // recommendations) start with a capital, "19 %" -> "19%", and the
  // non-breaking hyphens some models emit become plain ones.
  const tidy = (t) => String(t)
    .replace(/\u2011/g, '-')
    .replace(/(\d)\s+%/g, '$1%')
    .replace(/^(\s*\d{1,2}[.)]\s*)?([a-z])/, (_, n, c) => `${n || ''}${c.toUpperCase()}`);
  const cleanParagraphs = paragraphs.map(tidy);
  for (const t of tables) t.rows = t.rows.map((r) => r.map((c) => (typeof c === 'string' ? tidy(c) : c)));

  return { title: section.title, visuals: Object.keys(v).length ? v : null, tables, paragraphs: cleanParagraphs };
}
