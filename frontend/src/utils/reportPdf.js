import { jsPDF } from 'jspdf';
import { formatMoney, formatCompactMoney, TONE_COLORS } from './reportVisuals';

const ACCENT = '#bf4a53';
const COMPANY = "Mylene's Boutique";
const TAGLINE = 'Rental Attire & Formal Wear';
const ADDRESS = 'Balayan, Batangas, Philippines';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// jsPDF's built-in fonts are WinAnsi and do NOT contain the Philippine peso
// sign (₱) or several typographic characters. Replace them with safe ASCII so
// the downloaded PDF never shows missing glyphs.
//
// Small provider models also leak raw ASCII control characters (e.g. \x11)
// into the report text. A single control byte embedded in a PDF text string
// makes some viewers render the ENTIRE line letter-spaced, so strip all C0
// controls (keeping tab/LF/CR) before anything reaches jsPDF.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// Exported for testing: must strip every C0 control so no raw control byte
// ever reaches a jsPDF text string.
export function toPdfText(s) {
  return (s || '')
    .replace(CONTROL_CHARS, '')
    .replace(/₱/g, 'PHP ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '-')
    .replace(/→/g, '->')
    .replace(/≈/g, '~');
}

function buildDoc(bodySize, sections, meta) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageW - margin * 2;
  const [ar, ag, ab] = hexToRgb(ACCENT);

  const lineH = bodySize * 0.62;
  const titleSize = bodySize + 3;
  const footerRoom = 16; // mm reserved at the bottom for the footer

  // ---- Letterhead band ----
  const headerH = 24;
  doc.setFillColor(ar, ag, ab);
  doc.rect(0, 0, pageW, headerH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(toPdfText(COMPANY), margin, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(toPdfText(TAGLINE), margin, 15);
  doc.text(toPdfText(ADDRESS), margin, 19.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Business Performance Report', pageW - margin, 9, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Date: ${meta.generatedDate || ''}`, pageW - margin, 14, { align: 'right' });
  doc.text(`Ref: ${meta.docRef || ''}`, pageW - margin, 18.5, { align: 'right' });

  let y = headerH + 9;
  const ensureSpace = (needed) => {
    if (y + needed > pageH - footerRoom) {
      doc.addPage();
      y = margin + 4;
    }
  };

  // ---- Charts (same figures as the on-screen modal) ----
  const label7 = (text, x, yy, opts) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(110, 110, 110);
    doc.text(toPdfText(text).toUpperCase(), x, yy, opts);
  };
  const fill = (hex) => doc.setFillColor(...hexToRgb(hex));

  const drawTiles = (tiles) => {
    const h = 17;
    const gap = 3;
    const w = (contentW - gap * (tiles.length - 1)) / tiles.length;
    ensureSpace(h + 4);
    tiles.forEach((t, i) => {
      const x = margin + i * (w + gap);
      doc.setFillColor(248, 248, 249);
      doc.setDrawColor(232, 232, 235);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
      label7(t.label, x + 3, y + 4.5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      if (t.tone === 'critical') doc.setTextColor(...hexToRgb(TONE_COLORS.critical));
      else doc.setTextColor(20, 20, 20);
      const v = t.format === 'money' ? formatMoney(t.value) : t.format === 'pct' ? `${t.value}%` : String(t.value);
      doc.text(toPdfText(v), x + 3, y + 10.5);
      if (t.meter != null) {
        doc.setFillColor(229, 231, 235);
        doc.rect(x + 3, y + 12.5, w - 6, 1.4, 'F');
        doc.setFillColor(ar, ag, ab);
        doc.rect(x + 3, y + 12.5, ((w - 6) * Math.min(100, t.meter)) / 100, 1.4, 'F');
      } else if (t.delta != null || t.sub) {
        doc.setFontSize(6.5);
        let sx = x + 3;
        if (t.delta != null) {
          const d = `${t.delta >= 0 ? '+' : '-'}${Math.abs(t.delta).toFixed(1)}%`;
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...hexToRgb(t.delta >= 0 ? TONE_COLORS.good : TONE_COLORS.critical));
          doc.text(d, sx, y + 14.5);
          sx += doc.getTextWidth(d) + 1.5;
        }
        if (t.sub) {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(110, 110, 110);
          const room = x + w - 2 - sx;
          doc.text(doc.splitTextToSize(toPdfText(t.sub), room)[0] || '', sx, y + 14.5);
        }
      }
    });
    y += h + 5;
  };

  const drawShare = (title, parts, unit) => {
    const total = parts.reduce((a, p) => a + p.value, 0);
    if (!total) return;
    ensureSpace(15);
    label7(title, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    doc.text(`${total.toLocaleString('en-PH')} ${unit}`, margin + contentW, y, { align: 'right' });
    y += 2;
    let x = margin;
    const barH = 3.2;
    const shown = parts.filter((p) => p.value > 0);
    shown.forEach((p, i) => {
      const w = (contentW * p.value) / total - (i < shown.length - 1 ? 0.5 : 0);
      fill(TONE_COLORS[p.tone]);
      doc.rect(x, y, Math.max(0.3, w), barH, 'F');
      x += w + 0.5;
    });
    y += barH + 4;
    x = margin;
    doc.setFontSize(7);
    for (const p of parts) {
      fill(TONE_COLORS[p.tone]);
      doc.rect(x, y - 2.1, 2.2, 2.2, 'F');
      const txt = `${p.label}  ${p.value.toLocaleString('en-PH')}  (${((p.value / total) * 100).toFixed(0)}%)`;
      doc.setTextColor(60, 60, 60);
      doc.text(txt, x + 3.3, y);
      x += doc.getTextWidth(txt) + 9;
    }
    y += 7;
  };

  // rows: {label, frac, text, track?, trend?} - `track` (0..1) shortens the
  // gray background (used for "rented of total units").
  const drawBars = (title, note, rows) => {
    const rowH = 4.8;
    ensureSpace(6 + rowH * Math.min(rows.length, 3));
    label7(title, margin, y);
    if (note) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(150, 150, 150);
      doc.text(toPdfText(note), margin + contentW, y, { align: 'right' });
    }
    y += 3.5;
    const labelW = 50;
    const valueW = 24;
    const barX = margin + labelW;
    const barW = contentW - labelW - valueW;
    for (const r of rows) {
      ensureSpace(rowH);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(70, 70, 70);
      doc.text(doc.splitTextToSize(toPdfText(r.label), labelW - 3)[0] || '', margin, y + 2.6);
      const trackW = barW * (r.track ?? 1);
      doc.setFillColor(241, 242, 244);
      doc.rect(barX, y + 0.4, trackW, 2.8, 'F');
      doc.setFillColor(ar, ag, ab);
      doc.rect(barX, y + 0.4, Math.max(0.6, trackW * r.frac), 2.8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(20, 20, 20);
      doc.text(toPdfText(r.text), margin + contentW - (r.trend ? 4 : 0), y + 2.6, { align: 'right' });
      if (r.trend) {
        const cx = margin + contentW - 1.3;
        const cy = y + 1.8;
        if (r.trend === 'flat') {
          doc.setDrawColor(160, 160, 160);
          doc.setLineWidth(0.4);
          doc.line(cx - 1.1, cy, cx + 1.1, cy);
        } else {
          fill(r.trend === 'up' ? TONE_COLORS.good : TONE_COLORS.critical);
          if (r.trend === 'up') doc.triangle(cx - 1.2, cy + 0.9, cx + 1.2, cy + 0.9, cx, cy - 1.1, 'F');
          else doc.triangle(cx - 1.2, cy - 0.9, cx + 1.2, cy - 0.9, cx, cy + 1.1, 'F');
        }
      }
      y += rowH;
    }
    y += 5;
  };

  const drawVisuals = (v) => {
    const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    const simple = (rows, fmt) => {
      const max = Math.max(...rows.map((r) => r.value), 0) || 1;
      return rows.map((r) => ({ label: r.label, frac: r.value / max, text: fmt(r.value), trend: r.trend }));
    };
    if (v.tiles?.length) drawTiles(v.tiles);
    if (v.status?.length) drawShare('Rentals by status', v.status, 'rentals');
    if (v.revenueByCategory?.length) {
      drawBars('Revenue by category', null, simple(v.revenueByCategory, formatCompactMoney));
    }
    if (v.stock) {
      drawShare('Inventory right now', [
        { label: 'In use', value: v.stock.inUse, tone: 'info' },
        { label: 'Available', value: v.stock.available, tone: 'muted' },
      ], 'items');
    }
    if (v.categoryBreakdown?.length) {
      const max = Math.max(...v.categoryBreakdown.map((r) => r.total), 1);
      drawBars('Units rented by category', 'filled = rented, track = total units', v.categoryBreakdown.map((r) => ({
        label: r.label,
        track: r.total / max,
        frac: r.total ? Math.min(1, r.rented / r.total) : 0,
        text: `${r.rented} / ${r.total}`,
      })));
    }
    if (v.topItems?.length) drawBars('Most-rented items', 'rentals', simple(v.topItems, fmtNum));
    if (v.projections?.length) {
      drawBars('Projected rentals per month', 'by category', simple(v.projections, fmtNum));
    }
  };

  // Table: header band, ruled rows; a 2-column metric list longer than 8 rows
  // splits into two side-by-side halves to save vertical space.
  const drawTableBlock = (t, x, w, rows) => {
    const rowH = 5.6;
    const colW = t.columns.map((_, i) => (i === 0 ? w * (t.columns.length > 2 ? 0.4 : 0.6) : 0));
    const rest = (w - colW[0]) / Math.max(1, t.columns.length - 1);
    for (let i = 1; i < t.columns.length; i++) colW[i] = rest;
    const cellX = (i, right) => {
      const start = x + colW.slice(0, i).reduce((a, b) => a + b, 0);
      return right ? start + colW[i] - 2 : start + 2;
    };
    let yy = y;
    doc.setFillColor(246, 246, 247);
    doc.rect(x, yy, w, rowH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(110, 110, 110);
    t.columns.forEach((c, i) => {
      const right = t.align[i] === 'right';
      doc.text(toPdfText(c).toUpperCase(), cellX(i, right), yy + 3.8, right ? { align: 'right' } : undefined);
    });
    yy += rowH;
    doc.setFontSize(8);
    for (const r of rows) {
      r.forEach((cell, i) => {
        const right = t.align[i] === 'right';
        doc.setFont('helvetica', i === 0 ? 'normal' : 'bold');
        doc.setTextColor(i === 0 ? 60 : 20, i === 0 ? 60 : 20, i === 0 ? 60 : 20);
        const txt = doc.splitTextToSize(toPdfText(cell), colW[i] - 3)[0] || '';
        doc.text(txt, cellX(i, right), yy + 3.8, right ? { align: 'right' } : undefined);
      });
      yy += rowH;
      doc.setDrawColor(235, 235, 237);
      doc.setLineWidth(0.15);
      doc.line(x, yy, x + w, yy);
    }
    doc.setDrawColor(220, 220, 224);
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, yy - y);
    return yy - y;
  };

  const drawTable = (t) => {
    const split = t.rows.length > 8 && t.columns.length === 2;
    const half = split ? Math.ceil(t.rows.length / 2) : t.rows.length;
    const height = 5.6 * (half + 1);
    ensureSpace(height + 6);
    label7(t.title, margin, y);
    y += 2.5;
    if (split) {
      const gap = 4;
      const w = (contentW - gap) / 2;
      drawTableBlock(t, margin, w, t.rows.slice(0, half));
      drawTableBlock(t, margin + w + gap, w, t.rows.slice(half));
    } else {
      drawTableBlock(t, margin, contentW, t.rows);
    }
    y += height + 6;
  };

  for (const sec of sections) {
    if (!sec.title && sec.paragraphs.length === 0) continue;
    ensureSpace(titleSize / 2 + 10);
    if (sec.title) {
      doc.setTextColor(ar, ag, ab);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(titleSize);
      doc.text(toPdfText(sec.title), margin, y);
      y += 3;
      doc.setDrawColor(ar, ag, ab);
      doc.setLineWidth(0.4);
      doc.line(margin, y, margin + contentW, y);
      y += 6;
    }
    if (sec.visuals) drawVisuals(sec.visuals);
    for (const t of sec.tables) drawTable(t);
    doc.setTextColor(35, 35, 35);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(bodySize);
    for (const line of sec.paragraphs) {
      const text = toPdfText(line);
      if (!text.trim()) {
        y += 2.5;
        continue;
      }
      const wrapped = doc.splitTextToSize(text, contentW);
      for (const w of wrapped) {
        ensureSpace(lineH);
        doc.text(w, margin, y);
        y += lineH;
      }
      y += 2;
    }
    y += 5;
  }

  // ---- Footer on every page ----
  const total = doc.internal.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - footerRoom + 4, pageW - margin, pageH - footerRoom + 4);
    doc.setTextColor(130, 130, 130);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(
      toPdfText(`${COMPANY} AI Analytics - Confidential, for management use only`),
      margin,
      pageH - footerRoom + 8
    );
    doc.text(`Page ${p} of ${total}`, pageW - margin, pageH - footerRoom + 8, { align: 'right' });
  }

  return doc;
}

/**
 * Build and download a properly formatted business-report PDF.
 * `sections` come from `layoutSection` (reportVisuals.js): each is drawn as
 * charts, then a table of its figures, then the explanation paragraphs, under
 * a branded letterhead and above a footer with page numbers.
 * Content is written at a comfortable, readable size; only if it would
 * genuinely overflow one page (text-only reports) is the font gently reduced
 * (never below a readable minimum).
 */
export function generateReportPdf(sections, meta = {}) {
  let bodySize = 10.5;
  let doc = buildDoc(bodySize, sections, meta);
  const hasVisuals = (sections || []).some((s) => s.visuals || s.tables.length);
  // Charts make a multi-page report anyway, so only squeeze text-only ones.
  while (!hasVisuals && doc.internal.getNumberOfPages() > 1 && bodySize > 9) {
    bodySize -= 0.5;
    doc = buildDoc(bodySize, sections, meta);
  }
  doc.save(`${COMPANY} - Business Performance Report.pdf`);
}
