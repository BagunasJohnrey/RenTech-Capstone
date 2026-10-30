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
    tiles.push({ label: 'Total revenue', value: k.totalRevenue, format: 'money', sub: 'all time' });
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

/**
 * @param {{title: string, bodyLines: string[]}[]} sections from parseReportSections
 * @returns {Record<string, object>} visuals keyed by the section they belong to
 */
export function extractReportVisuals(sections) {
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

export function formatMoney(n) {
  return `₱${Math.round(n).toLocaleString('en-PH')}`;
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
const LIST_INTRO = /^(category breakdown|category projections|revenue by category)\s*:?\s*$/i;

// A short "Label: value" fact (a number, percent or peso amount), not a sentence.
function isMetricLine(line) {
  const m = KV_LINE.exec(line.trim());
  if (!m) return null;
  const value = m[2].trim().replace(/\.$/, '');
  if (!/\d/.test(value) || value.split(/\s+/).length > 4) return null;
  return { label: m[1].trim(), value };
}

const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const TREND_WORD = { up: 'Rising', down: 'Falling', flat: 'Flat' };

export function layoutSection(section, visuals) {
  const v = visualsFor(visuals, section.title) || {};
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
      breakdown.push({ label: m[1].trim(), total: +m[2], rented: +m[3] });
    } else if ((m = PROJECTION_LINE.exec(line))) {
      const t = (m[3] || '').toLowerCase();
      projections.push({
        label: m[1].trim(),
        value: parseFloat(m[2]),
        trend: /up|rising/.test(t) ? 'up' : /down|falling/.test(t) ? 'down' : 'flat',
      });
    } else if (LIST_INTRO.test(line)) {
      // "Category breakdown:" heading — the table below carries it.
    } else if (/^revenue by category\b/i.test(line) && v.revenueByCategory?.length) {
      // Restated by the revenue table.
    } else if (/most[- ]rented|top rented/i.test(line) && /\(\d+\s*rentals?\)/i.test(line) && v.topItems?.length) {
      // Restated by the most-rented table.
    } else if ((m = isMetricLine(line))) {
      metrics.push(m);
    } else {
      paragraphs.push(line);
    }
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
      title: 'Revenue figures',
      columns: ['Category', 'Revenue', 'Share'],
      align: ['left', 'right', 'right'],
      rows: v.revenueByCategory.map((r) => [r.label, formatMoney(r.value), pct(r.value, total)]),
    });
  }
  if (breakdown.length) {
    tables.push({
      title: 'Category breakdown',
      columns: ['Category', 'Total units', 'Rented', '% rented'],
      align: ['left', 'right', 'right', 'right'],
      rows: breakdown.map((r) => [r.label, String(r.total), String(r.rented), pct(r.rented, r.total)]),
    });
  }
  if (v.topItems?.length) {
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

  return { title: section.title, visuals: Object.keys(v).length ? v : null, tables, paragraphs };
}
