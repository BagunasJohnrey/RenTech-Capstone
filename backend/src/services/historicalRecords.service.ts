import ExcelJS from 'exceljs';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { clearDataCache } from '../utils/ttlCache.js';

// Imported historical rental records (paper logbooks, pre-system walk-ins).
// ANALYTICAL ONLY — these rows feed the demand forecast + category split and
// never touch the live Transaction table (which drives availability, revenue
// KPIs and the reminder scheduler).

export const MAX_IMPORT_ROWS = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB — logbooks are small text
const ALLOWED_EXT = /\.(csv|xlsx)$/i;

// Header aliases (lowercased + trimmed before lookup) so real-world files
// with slightly different column names still map. Canonical output keys are
// customerName | category | address | eventDate | price.
const HEADER_ALIASES: Record<string, string> = {
  name: 'customerName', customer: 'customerName', customername: 'customerName',
  client: 'customerName', customer_name: 'customerName',
  category: 'category', type: 'category', itemtype: 'category',
  item_type: 'category', itemcategory: 'category',
  address: 'address', location: 'address', area: 'address', barangay: 'address',
  eventdate: 'eventDate', event_date: 'eventDate', 'event date': 'eventDate',
  date: 'eventDate', rentaldate: 'eventDate', rental_date: 'eventDate',
  dateevent: 'eventDate', 'date event': 'eventDate',
  price: 'price', amount: 'price', fee: 'price', rentalfee: 'price',
  rental_fee: 'price', total: 'price',
};

const REQUIRED_FIELDS = ['category', 'address', 'eventDate', 'price'] as const;

export interface ParsedRow {
  customerName: string | null;
  category: string;
  address: string;
  eventDate: Date;
  price: number;
}

export interface RowError {
  row: number; // 1-based spreadsheet row (header = 1)
  message: string;
}

// Quote-aware CSV split: handles "Balayan, Batangas" and ""escaped"" quotes.
// Exported for unit tests.
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function normalizeHeader(h: unknown): string | null {
  const key = String(h ?? '').trim().toLowerCase();
  return HEADER_ALIASES[key] ?? null;
}

// Accepts: Date objects (Excel date cells), Excel serial numbers, ISO
// YYYY-MM-DD (the template format — unambiguous), and anything Date.parse
// handles ("Oct 5, 2024"). Returns null when unparseable.
export function parseEventDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
    // Excel serial (days since 1899-12-30).
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.length > 10 ? s : `${s}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Accepts 1500, "1,500", "PHP 1,500", "₱1500". Must be a finite number ≥ 0.
export function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const cleaned = String(value).replace(/[₱]/g, '').replace(/php/i, '').replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseCsvRows(text: string): { headers: (string | null)[]; body: string[][] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  // Skip leading blank lines (Excel exports often start with one).
  while (lines.length && lines[0].trim() === '') lines.shift();
  if (!lines.length) return { headers: [], body: [] };
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  // Drop fully-empty rows (trailing ",,,," lines, stray spaces) — pasted
  // sheets almost always carry invisible blank rows at the bottom, and those
  // are not data errors worth blocking an import over.
  const body = lines
    .slice(1)
    .map(splitCsvLine)
    .filter((cells) => cells.some((c) => c.trim() !== ''));
  return { headers, body };
}

async function parseXlsxRows(buffer: Buffer): Promise<{ headers: (string | null)[]; body: unknown[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], body: [] };
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: unknown[] = [];
    // row.values is 1-based (index 0 empty) — slice it off.
    const raw = row.values as unknown[];
    for (let i = 1; i < raw.length; i++) {
      const v = raw[i];
      // Rich text / formula results → plain text.
      vals.push(v !== null && typeof v === 'object' && 'text' in (v as Record<string, unknown>)
        ? String((v as { text: unknown }).text)
        : v);
    }
    rows.push(vals);
  });
  // Skip leading blank rows.
  while (rows.length && rows[0].every((v) => v === null || v === undefined || String(v).trim() === '')) rows.shift();
  if (!rows.length) return { headers: [], body: [] };
  // Drop fully-empty body rows (trailing formatted/whitespace rows Excel
  // keeps in the used range) — same rule as the CSV parser above.
  const body = rows.slice(1).filter(
    (r) => !r.every((v) => v === null || v === undefined || String(v).trim() === '')
  );
  return { headers: rows[0].map(normalizeHeader), body };
}

function resolveColumns(headers: (string | null)[]): { missing: string[]; indexOf: Record<string, number> } {
  const indexOf: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h && !(h in indexOf)) indexOf[h] = i;
  });
  const missing = (['customerName', ...REQUIRED_FIELDS] as string[]).filter((f) => !(f in indexOf));
  // customerName is optional — a file without a name column is still valid.
  return { missing: missing.filter((f) => f !== 'customerName'), indexOf };
}

export interface ValidatedImport {
  rows: ParsedRow[];
  errors: RowError[];
}

export function validateBody(
  headers: (string | null)[],
  body: unknown[][],
  headerRowNumber = 1,
): ValidatedImport {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const { missing, indexOf } = resolveColumns(headers);
  if (missing.length > 0) {
    return { rows, errors: [{ row: headerRowNumber, message: `Missing column(s): ${missing.join(', ')}` }] };
  }
  body.forEach((cells, i) => {
    const rowNum = headerRowNumber + 1 + i;
    const get = (f: string): unknown => {
      const v = (cells as unknown[])[indexOf[f]];
      return typeof v === 'string' ? v.trim() : v;
    };
    const category = String(get('category') ?? '').trim();
    const address = String(get('address') ?? '').trim();
    const rawName = get('customerName');
    const customerName = rawName === null || rawName === undefined || String(rawName).trim() === ''
      ? null
      : String(rawName).trim().slice(0, 120);
    const eventDate = parseEventDate(get('eventDate'));
    const price = parsePrice(get('price'));
    const problems: string[] = [];
    if (!category) problems.push('category is required');
    if (!address) problems.push('address is required');
    if (!eventDate) problems.push('event date is not a valid date (use YYYY-MM-DD)');
    if (price === null) problems.push('price is not a valid amount');
    if (problems.length > 0) {
      errors.push({ row: rowNum, message: problems.join('; ') });
      return;
    }
    rows.push({
      customerName,
      category: category.slice(0, 80),
      address: address.slice(0, 200),
      eventDate: eventDate as Date,
      price: price as number,
    });
  });
  return { rows, errors };
}

export async function importRecords(params: {
  fileName: string;
  buffer: Buffer;
  importedById: string;
}): Promise<{ imported: number; skippedDuplicates: number; categories: string[] }> {
  const { fileName, buffer, importedById } = params;
  if (!ALLOWED_EXT.test(fileName)) {
    throw new AppError(400, 'Only .csv and .xlsx files can be imported');
  }
  if (!Number.isInteger(buffer.length) || buffer.length === 0 || buffer.length > MAX_FILE_BYTES) {
    throw new AppError(400, 'File is empty or exceeds the 2MB limit');
  }

  const isXlsx = /\.xlsx$/i.test(fileName);
  const { headers, body } = isXlsx
    ? await parseXlsxRows(buffer).catch(() => {
        throw new AppError(400, 'Could not read the spreadsheet — is it a valid .xlsx file?');
      })
    : parseCsvRows(buffer.toString('utf-8'));

  if (headers.length === 0) {
    throw new AppError(400, 'The file has no header row. Download the template to see the expected columns.');
  }
  if (body.length === 0) {
    throw new AppError(400, 'The file has no data rows.');
  }
  if (body.length > MAX_IMPORT_ROWS) {
    throw new AppError(400, `Too many rows (${body.length}) — maximum ${MAX_IMPORT_ROWS} per import`);
  }

  // All-or-nothing: a logbook with bad rows imports nothing, and the error
  // names every bad row so staff can fix the file and retry once.
  const { rows, errors } = validateBody(headers, body);
  if (errors.length > 0) {
    throw new AppError(400, `${errors.length} row(s) need fixing`, { errors: errors.slice(0, 25) });
  }

  // Duplicate guard: an exact match on every field (name/category/address/
  // day/price) is a re-import, not a new rental — importing the same file
  // twice must not double the forecast. Day-level date match (time ignored)
  // so Excel time components can't sneak past the check.
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const rowKey = (r: { customerName: string | null; category: string; address: string; eventDate: Date; price: number }) =>
    [r.customerName ?? '', r.category.toLowerCase(), r.address.toLowerCase(), dayKey(r.eventDate), r.price].join('|');
  let existingKeys = new Set<string>();
  try {
    const existing = await prisma.historicalRecord.findMany({
      select: { customerName: true, category: true, address: true, eventDate: true, price: true },
    });
    existingKeys = new Set(existing.map((e) => rowKey({
      customerName: e.customerName,
      category: e.category,
      address: e.address,
      eventDate: e.eventDate,
      price: e.price,
    })));
  } catch { /* dedupe is best-effort — import proceeds without it */ }
  const fresh = rows.filter((r) => !existingKeys.has(rowKey(r)));
  const skippedDuplicates = rows.length - fresh.length;

  if (fresh.length === 0) {
    return { imported: 0, skippedDuplicates, categories: [...new Set(rows.map((r) => r.category))].sort() };
  }

  await prisma.historicalRecord.createMany({
    data: fresh.map((r) => ({ ...r, source: 'import', importedById })),
  });

  // Forecast + dashboard caches move — refresh so the new history shows up.
  clearDataCache();

  try {
    await createAuditLog({
      action: 'records.import', entity: 'records', entityId: 'bulk-import',
      performedById: importedById,
      newValue: { fileName, imported: fresh.length, skippedDuplicates },
    });
  } catch { /* audit is non-critical */ }

  return { imported: fresh.length, skippedDuplicates, categories: [...new Set(fresh.map((r) => r.category))].sort() };
}

export async function listRecords(params: { limit?: number; offset?: number }) {
  const take = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const skip = Math.max(params.offset ?? 0, 0);
  const [rows, total] = await Promise.all([
    prisma.historicalRecord.findMany({
      orderBy: { eventDate: 'desc' },
      take, skip,
      include: { importedBy: { select: { id: true, name: true } } },
    }),
    prisma.historicalRecord.count(),
  ]);
  return { rows, total };
}

export async function deleteRecord(id: string, performedById: string) {
  const row = await prisma.historicalRecord.findUnique({ where: { id } });
  if (!row) throw new AppError(404, 'Record not found');
  await prisma.historicalRecord.delete({ where: { id } });
  clearDataCache();
  try {
    await createAuditLog({
      action: 'records.delete', entity: 'records', entityId: id,
      performedById,
    });
  } catch { /* audit is non-critical */ }
  return { id };
}

export async function getRecordStats() {
  const [total, oldest, newest, byCategory] = await Promise.all([
    prisma.historicalRecord.count(),
    prisma.historicalRecord.findFirst({ orderBy: { eventDate: 'asc' }, select: { eventDate: true } }),
    prisma.historicalRecord.findFirst({ orderBy: { eventDate: 'desc' }, select: { eventDate: true } }),
    prisma.historicalRecord.groupBy({ by: ['category'], _count: { id: true } }),
  ]);
  return {
    total,
    oldest: oldest?.eventDate ?? null,
    newest: newest?.eventDate ?? null,
    categories: byCategory
      .map((c) => ({ category: c.category, count: c._count.id }))
      .sort((a, b) => b.count - a.count),
  };
}
