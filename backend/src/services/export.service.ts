import { readFile } from 'node:fs/promises';
import { prisma } from '../config/database.js';
import ExcelJS from 'exceljs';
import { getBusinessRules } from './settings.service.js';

// ── Brand palette (mirrors frontend #bf4a53 brand) ──────────────────────────
const BRAND = 'BF4A53';
const BRAND_DEEP = '7C2230';
const WHITE = 'FFFFFFFF';
const ZEBRA = 'FFF9FA';
const BORDER_GRAY = 'E8DFE1';
const BAND_GRAY = 'F3F4F6';
const EMERALD_BG = 'D1FAE5';
const BLUE_BG = 'DBEAFE';
const INDIGO_BG = 'E0E7FF';
const ORANGE_BG = 'FFEDD5';
const RED_BG = 'FEE2E2';
const GRAY_BG = 'F3F4F6';

// One color = one meaning, matching the frontend status pill legend:
//   green  = good / ready       (Available, Returned)
//   blue   = out with customer  (Rented, Active)
//   indigo = booked ahead       (Reserved)
//   orange = in process         (Cleaning)
//   red    = problem / urgent   (OutOfService, Overdue)
//   gray   = neutral / archived (Deleted, Cancelled)
const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  Available: { bg: EMERALD_BG, fg: '047857' },
  Returned: { bg: EMERALD_BG, fg: '047857' },
  Rented: { bg: BLUE_BG, fg: '1D4ED8' },
  Active: { bg: BLUE_BG, fg: '1D4ED8' },
  Reserved: { bg: INDIGO_BG, fg: '4338CA' },
  Cleaning: { bg: ORANGE_BG, fg: 'C2410C' },
  OutOfService: { bg: RED_BG, fg: 'B91C1C' },
  Overdue: { bg: RED_BG, fg: 'B91C1C' },
  Deleted: { bg: GRAY_BG, fg: '6B7280' },
  Cancelled: { bg: GRAY_BG, fg: '6B7280' },
};

interface ColDef {
  header: string;
  key: string;
  width: number;
  type?: 'string' | 'number' | 'currency' | 'date';
  align?: 'left' | 'right' | 'center';
}

const BASE_FONT = { name: 'Segoe UI', size: 10, color: { argb: '1F2937' } };

function columnLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface SheetSpec {
  sheetName: string;
  title: string;    // report name, e.g. "Transactions"
  subtitle: string; // period + row count
  columns: ColDef[];
  rows: Record<string, unknown>[];
  statusKey?: string;
  totalsCols?: string[]; // numeric column keys to sum into a footer row
  totalLabel?: string;
}

// ── Letterhead: logo + business profile + who exported it ─────────────────
// Same identity as the PDF report. Name/address/contact come from the
// admin's Settings → General → Business Profile (BusinessRule rows).
export interface ExportedBy { name: string; role: string }

interface Letterhead {
  business: string;
  address: string;
  contact: string;
  exportedBy?: ExportedBy;
  generatedAt: string;
  logo: Buffer | null;
}

const DEFAULT_BUSINESS = "Mylene's Boutique";
const DEFAULT_ADDRESS = 'Balayan, Batangas, Philippines';
const LOGO_URL = new URL('../../assets/report-logo.png', import.meta.url);
const HEADER_ROWS = 4;

let logoCache: Buffer | null | undefined;
async function loadLogo(): Promise<Buffer | null> {
  if (logoCache !== undefined) return logoCache;
  try { logoCache = await readFile(LOGO_URL); } catch { logoCache = null; }
  return logoCache;
}

async function loadLetterhead(exportedBy?: ExportedBy): Promise<Letterhead> {
  let rules: Record<string, string> = {};
  try { rules = await getBusinessRules(); } catch { /* fall back to defaults */ }
  return {
    business: rules.business_name?.trim() || DEFAULT_BUSINESS,
    address: rules.business_address?.trim() || DEFAULT_ADDRESS,
    contact: rules.business_contact?.trim() || '',
    exportedBy,
    generatedAt: new Date().toLocaleString('en-PH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
    }),
    logo: await loadLogo(),
  };
}

function newWorkbook(title: string, head: Letterhead): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = head.exportedBy?.name || 'RenTech';
  wb.title = `${head.business} — ${title}`;
  wb.subject = wb.title;
  return wb;
}

// Adds one report sheet to an (existing) workbook so the combined download can
// hold Transactions + Revenue + Inventory as separate sheets in a single file.
function addSheet(wb: ExcelJS.Workbook, opts: SheetSpec, head: Letterhead): void {
  const {
    sheetName, title, subtitle, columns, rows,
    statusKey, totalsCols = [], totalLabel = 'TOTAL',
  } = opts;

  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: HEADER_ROWS + 1 }], // freeze table header under the letterhead
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } as never,
  });
  ws.properties.defaultRowHeight = 18;

  const lastCol = columns.length;
  const headerRowIdx = HEADER_ROWS + 1;
  const dataStartRow = headerRowIdx + 1;
  const lastDataRow = dataStartRow + rows.length - 1;

  // ── Letterhead (rows 1-4): logo in column A, text merged across B..last ──
  //   1  Business name — report title
  //   2  Address · Contact
  //   3  Period · row count
  //   4  Exported by <name> (<role>) · Generated <Manila time>
  const LIGHT = 'FFFAF5F6';
  const textCol = lastCol > 1 ? 2 : 1;
  const exporter = head.exportedBy ? `${head.exportedBy.name} (${head.exportedBy.role})` : 'RenTech';
  const lines: { text: string; size: number; bold?: boolean; color: string; height: number }[] = [
    { text: `${head.business} — ${title}`, size: 16, bold: true, color: BRAND_DEEP, height: 30 },
    { text: [head.address, head.contact && `Contact: ${head.contact}`].filter(Boolean).join('  ·  '), size: 10, color: '4B5563', height: 18 },
    { text: subtitle, size: 10, color: '6B7280', height: 18 },
    { text: `Exported by ${exporter}  ·  Generated ${head.generatedAt}`, size: 9, color: '6B7280', height: 18 },
  ];
  lines.forEach((line, i) => {
    const r = i + 1;
    for (let c = 1; c <= lastCol; c++) {
      ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    }
    if (lastCol > textCol) ws.mergeCells(r, textCol, r, lastCol);
    const cell = ws.getCell(r, textCol);
    cell.value = line.text;
    cell.font = { name: 'Segoe UI', size: line.size, bold: !!line.bold, color: { argb: line.color } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(r).height = line.height;
  });
  // Brand rule under the letterhead.
  for (let c = 1; c <= lastCol; c++) {
    ws.getCell(HEADER_ROWS, c).border = { bottom: { style: 'medium', color: { argb: BRAND } } };
  }
  if (head.logo) {
    const imageId = wb.addImage({ buffer: head.logo as unknown as ExcelJS.Buffer, extension: 'png' });
    // 64px square floated over A1:A4 (column A is widened below to fit it).
    ws.addImage(imageId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 64, height: 64 }, editAs: 'oneCell' });
  }

  // ── Header row ────────────────────────────────────────────────────────
  ws.getRow(headerRowIdx).height = 24;
  columns.forEach((col, i) => {
    const cell = ws.getCell(headerRowIdx, i + 1);
    cell.value = col.header;
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: isRightAligned(col) ? 'right' : col.type === 'date' || col.align === 'center' ? 'center' : 'left',
      indent: isRightAligned(col) || col.type === 'date' || col.align === 'center' ? 0 : 1,
    };
    cell.border = { bottom: { style: 'thin', color: { argb: BRAND_DEEP } } };
    // Column A also hosts the letterhead logo, so keep it at least logo-wide.
    ws.getColumn(i + 1).width = i === 0 ? Math.max(col.width, 12) : col.width;
  });

  // ── Data rows ─────────────────────────────────────────────────────────
  rows.forEach((row, r) => {
    const excelRow = ws.getRow(dataStartRow + r);
    const zebra = r % 2 === 1;
    columns.forEach((col, c) => {
      const cell = excelRow.getCell(c + 1);
      const raw = row[col.key] ?? '';
      if (col.type === 'currency') {
        cell.value = raw === '' || raw == null ? '' : Number(raw) || 0;
        cell.numFmt = '₱#,##0.00';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (col.type === 'number') {
        cell.value = raw === '' || raw == null ? '' : Number(raw) || 0;
        cell.numFmt = '#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (col.type === 'date') {
        const dateStr = String(raw);
        const when = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
        const d = new Date(when);
        cell.value = Number.isNaN(d.getTime()) ? dateStr : d;
        cell.numFmt = 'mmm dd, yyyy';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.value = raw as ExcelJS.CellValue;
        cell.alignment = {
          vertical: 'middle',
          horizontal: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left',
          wrapText: typeof raw === 'string' && raw.length > 28,
        };
      }
      cell.font = BASE_FONT;
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: zebra ? ZEBRA : 'FFFFFFFF' },
      };
      cell.border = {
        top: { style: 'hair', color: { argb: BORDER_GRAY } },
        bottom: { style: 'hair', color: { argb: BORDER_GRAY } },
      };
    });

    if (statusKey && row[statusKey] != null) {
      const st = STATUS_STYLE[String(row[statusKey])];
      if (st) {
        const idx = columns.findIndex((c) => c.key === statusKey);
        const scell = excelRow.getCell(idx + 1);
        scell.value = row[statusKey] as ExcelJS.CellValue;
        scell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } };
        scell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: st.fg } };
        scell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    }
  });

  // ── Totals footer ─────────────────────────────────────────────────────
  if (totalsCols.length > 0 && rows.length > 0) {
    const tr = ws.getRow(lastDataRow + 1);
    tr.height = 22;
    columns.forEach((col, c) => {
      const cell = tr.getCell(c + 1);
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: BRAND_DEEP } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_GRAY } };
      cell.border = { top: { style: 'medium', color: { argb: BRAND } } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      if (c === 0) {
        cell.value = totalLabel;
      } else if (totalsCols.includes(col.key)) {
        const letter = columnLetter(c + 1);
        cell.value = { formula: `SUM(${letter}${dataStartRow}:${letter}${lastDataRow})` };
        cell.numFmt = '₱#,##0.00';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      }
    });
  }

  // ── Autofilter over the whole table (skip when no rows) ───────────────
  // The range MUST start on the header row and span every column: a narrower
  // band leaves the outside columns behind when the user sorts, scrambling
  // e.g. Customer/Item against their dates and amounts.
  if (rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIdx, column: 1 },
      to: { row: lastDataRow, column: lastCol },
    };
  }
}

// Money and counts always sit on the right (header and cells alike).
function isRightAligned(col: ColDef): boolean {
  return col.align === 'right' || col.type === 'currency' || col.type === 'number';
}

async function buildWorkbook(opts: SheetSpec, exportedBy?: ExportedBy): Promise<ExcelJS.Workbook> {
  const head = await loadLetterhead(exportedBy);
  const wb = newWorkbook(opts.title, head);
  addSheet(wb, opts, head);
  return wb;
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

// ════════════════════════════════════════════════════════════════════════════
// Reports
// ════════════════════════════════════════════════════════════════════════════

// Optional [start, end) window (same convention as the dashboard period
// filter) so the workbook download can be scoped to Overall / a year / a
// month. Transactions filter on createdAt, matching the dashboard KPIs.
export interface ExportWindow { start?: Date; end?: Date }

function txDateWhere(win?: ExportWindow) {
  if (!win?.start) return {};
  return { createdAt: { gte: win.start, ...(win.end ? { lt: win.end } : {}) } };
}

async function transactionsSheet(win?: ExportWindow, scopeLabel?: string): Promise<SheetSpec> {
  const transactions = await prisma.transaction.findMany({
    where: { ...txDateWhere(win) },
    include: {
      customer: { select: { name: true, email: true } },
      item: { select: { name: true, category: true } },
      assistedBy: { select: { name: true } },
      releasedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const columns: ColDef[] = [
    { header: 'Transaction ID', key: 'ID', width: 22 },
    { header: 'Customer', key: 'Customer', width: 22 },
    { header: 'Email', key: 'Email', width: 28 },
    { header: 'Assisted By', key: 'Assisted By', width: 20 },
    { header: 'Released By', key: 'Released By', width: 20 },
    { header: 'Item', key: 'Item', width: 26 },
    { header: 'Category', key: 'Category', width: 16 },
    { header: 'Rental Date', key: 'Rental Date', width: 14, type: 'date' },
    { header: 'Due Date', key: 'Due Date', width: 14, type: 'date' },
    { header: 'Return Date', key: 'Return Date', width: 14, type: 'date' },
    { header: 'Status', key: 'Status', width: 13, align: 'center' },
    { header: 'Rental Fee', key: 'Rental Fee', width: 15, type: 'currency' },
    { header: 'Downpayment', key: 'Downpayment', width: 15, type: 'currency' },
    { header: 'Late Penalty', key: 'Late Penalty', width: 15, type: 'currency' },
    { header: 'Damage Fee', key: 'Damage Fee', width: 15, type: 'currency' },
    { header: 'Balance', key: 'Balance', width: 15, type: 'currency' },
    { header: 'Notes', key: 'Notes', width: 30 },
  ];

  const rows = transactions.map((tx) => ({
    ID: tx.txNumber,
    Customer: tx.customer?.name || '',
    Email: tx.customer?.email || '',
    'Assisted By': (tx as { assistedBy?: { name?: string } | null }).assistedBy?.name || '',
    'Released By': (tx as { releasedBy?: { name?: string } | null }).releasedBy?.name || '',
    Item: tx.item?.name || '',
    Category: tx.item?.category || '',
    'Rental Date': tx.rentalDate.toISOString().split('T')[0],
    'Due Date': tx.dueDate.toISOString().split('T')[0],
    'Return Date': tx.returnDate ? tx.returnDate.toISOString().split('T')[0] : '',
    Status: tx.status,
    'Rental Fee': tx.rentalFee,
    Downpayment: tx.downpayment,
    'Late Penalty': tx.latePenalty,
    'Damage Fee': tx.damageFee,
    Balance: tx.balance,
    Notes: tx.notes || '',
  }));

  return {
    sheetName: 'Transactions',
    title: 'Transactions',
    subtitle: `Period: ${scopeLabel || 'All records'} · ${transactions.length} rental record(s)`,
    columns,
    rows,
    statusKey: 'Status',
    totalsCols: ['Rental Fee', 'Downpayment', 'Late Penalty', 'Damage Fee', 'Balance'],
  };
}

export async function exportTransactions(win?: ExportWindow, scopeLabel?: string, exportedBy?: ExportedBy): Promise<Buffer> {
  return toBuffer(await buildWorkbook(await transactionsSheet(win, scopeLabel), exportedBy));
}

async function revenueSheet(win?: ExportWindow, scopeLabel?: string): Promise<SheetSpec> {
  const transactions = await prisma.transaction.findMany({
    where: { status: { in: ['Returned', 'Active', 'Overdue'] }, ...txDateWhere(win) },
    include: {
      customer: { select: { name: true } },
      item: { select: { name: true, category: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const columns: ColDef[] = [
    { header: 'Transaction ID', key: 'ID', width: 22 },
    { header: 'Customer', key: 'Customer', width: 22 },
    { header: 'Item', key: 'Item', width: 26 },
    { header: 'Category', key: 'Category', width: 16 },
    { header: 'Rental Fee', key: 'Rental Fee', width: 15, type: 'currency' },
    { header: 'Downpayment', key: 'Downpayment', width: 15, type: 'currency' },
    { header: 'Late Penalty', key: 'Late Penalty', width: 15, type: 'currency' },
    { header: 'Damage Fee', key: 'Damage Fee', width: 15, type: 'currency' },
    { header: 'Total Paid', key: 'Total Paid', width: 15, type: 'currency' },
    { header: 'Balance', key: 'Balance', width: 15, type: 'currency' },
    { header: 'Status', key: 'Status', width: 12, align: 'center' },
    { header: 'Rental Date', key: 'Rental Date', width: 14, type: 'date' },
    { header: 'Due Date', key: 'Due Date', width: 14, type: 'date' },
    { header: 'Return Date', key: 'Return Date', width: 14, type: 'date' },
  ];

  const rows = transactions.map((tx) => ({
    ID: tx.txNumber,
    Customer: tx.customer?.name || '',
    Item: tx.item?.name || '',
    Category: tx.item?.category || '',
    'Rental Fee': tx.rentalFee,
    Downpayment: tx.downpayment,
    'Late Penalty': tx.latePenalty,
    'Damage Fee': tx.damageFee,
    'Total Paid': tx.totalPaid,
    Balance: tx.balance,
    Status: tx.status,
    'Rental Date': tx.rentalDate.toISOString().split('T')[0],
    'Due Date': tx.dueDate.toISOString().split('T')[0],
    'Return Date': tx.returnDate ? tx.returnDate.toISOString().split('T')[0] : '',
  }));

  return {
    sheetName: 'Revenue',
    title: 'Revenue',
    subtitle: `Period: ${scopeLabel || 'All records'} · ${rows.length} paid rental(s)`,
    columns,
    rows,
    statusKey: 'Status',
    totalsCols: ['Rental Fee', 'Downpayment', 'Late Penalty', 'Damage Fee', 'Total Paid', 'Balance'],
  };
}

export async function exportRevenue(win?: ExportWindow, scopeLabel?: string, exportedBy?: ExportedBy): Promise<Buffer> {
  return toBuffer(await buildWorkbook(await revenueSheet(win, scopeLabel), exportedBy));
}

async function inventorySheet(win?: ExportWindow, scopeLabel?: string): Promise<SheetSpec> {
  const items = await prisma.inventoryItem.findMany({
    include: {
      transactions: {
        where: {
          status: { in: ['Active', 'Returned', 'Overdue'] },
          ...txDateWhere(win),
        },
        select: {
          id: true,
          rentalFee: true,
          payments: {
            where: { status: { in: ['succeeded', 'completed'] } },
            select: { amount: true },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const columns: ColDef[] = [
    { header: 'Item ID', key: 'ID', width: 30 },
    { header: 'Name', key: 'Name', width: 26 },
    { header: 'Category', key: 'Category', width: 16 },
    { header: 'Price', key: 'Price', width: 14, type: 'currency' },
    { header: 'Status', key: 'Status', width: 16, align: 'center' },
    { header: 'Size', key: 'Size', width: 12, align: 'center' },
    { header: 'Total Rentals', key: 'Total Rentals', width: 14, type: 'number' },
    { header: 'Total Revenue', key: 'Total Revenue', width: 15, type: 'currency' },
    { header: 'Description', key: 'Description', width: 34 },
  ];

  const rows = items.map((item) => ({
    ID: item.id,
    Name: item.name,
    Category: item.category,
    Price: item.price,
    Status: item.status,
    Size: item.size || '',
    'Total Rentals': item.transactions.length,
    'Total Revenue': item.transactions.reduce(
      (s, t) => s + t.payments.reduce((a, p) => a + p.amount, 0),
      0
    ),
    Description: item.description || '',
  }));

  return {
    sheetName: 'Inventory',
    title: 'Inventory',
    subtitle: `Period: ${scopeLabel || 'All records'} · ${items.length} item(s)`,
    columns,
    rows,
    statusKey: 'Status',
    totalsCols: ['Total Revenue'],
  };
}

export async function exportInventory(win?: ExportWindow, scopeLabel?: string, exportedBy?: ExportedBy): Promise<Buffer> {
  return toBuffer(await buildWorkbook(await inventorySheet(win, scopeLabel), exportedBy));
}

// One .xlsx with a sheet per report — the AI Insights "Excel" button calls
// this so Overall / Yearly / Monthly all download together, pre-scoped.
export async function exportWorkbook(win?: ExportWindow, scopeLabel?: string, exportedBy?: ExportedBy): Promise<Buffer> {
  const head = await loadLetterhead(exportedBy);
  const wb = newWorkbook('Full Report', head);
  addSheet(wb, await transactionsSheet(win, scopeLabel), head);
  addSheet(wb, await revenueSheet(win, scopeLabel), head);
  addSheet(wb, await inventorySheet(win, scopeLabel), head);
  return toBuffer(wb);
}

// Audit trail export (Admin). Rows come pre-filtered from audit.service so
// the sheet matches what the admin sees on screen.
export interface AuditExportRow {
  createdAt: Date;
  action: string;
  entity: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  actor: { name: string; role: string } | null;
}

const JSON_CELL_MAX = 500;
function jsonCell(v: unknown): string {
  if (v == null) return '';
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text.length > JSON_CELL_MAX ? `${text.slice(0, JSON_CELL_MAX)}...` : text;
}

export async function exportAuditTrail(rows: AuditExportRow[], scopeLabel: string, exportedBy?: ExportedBy): Promise<Buffer> {
  const columns: ColDef[] = [
    { header: 'Date & Time', key: 'When', width: 22 },
    { header: 'Performed By', key: 'Actor', width: 24 },
    { header: 'Role', key: 'Role', width: 10, align: 'center' },
    { header: 'Action', key: 'Action', width: 28 },
    { header: 'Target', key: 'Entity', width: 16 },
    { header: 'Target ID', key: 'EntityId', width: 30 },
    { header: 'Before', key: 'Before', width: 40 },
    { header: 'After', key: 'After', width: 40 },
  ];
  const sheetRows = rows.map((r) => ({
    When: r.createdAt.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }),
    Actor: r.actor?.name || 'System',
    Role: r.actor?.role || 'Auto',
    Action: r.action,
    Entity: r.entity,
    EntityId: r.entityId,
    Before: jsonCell(r.oldValue),
    After: jsonCell(r.newValue),
  }));
  return toBuffer(await buildWorkbook({
    sheetName: 'Audit Trail',
    title: 'Audit Trail',
    subtitle: `Period: ${scopeLabel} · ${rows.length} event(s)`,
    columns,
    rows: sheetRows,
  }, exportedBy));
}

// L1: CSV-formula-injection note — cell values are written as literal
// strings via ExcelJS, so formulas in customer/item names are inert here by
// construction (no leading-sign escaping needed as with a CSV string).