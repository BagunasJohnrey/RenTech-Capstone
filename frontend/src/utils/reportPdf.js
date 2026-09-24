import { jsPDF } from 'jspdf';

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

  for (const sec of sections) {
    if (!sec.title && sec.bodyLines.length === 0) continue;
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
    doc.setTextColor(35, 35, 35);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(bodySize);
    for (const line of sec.bodyLines) {
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
 * Build and download a properly formatted, single-A4-page business-report PDF.
 * Lays out a branded letterhead, section headings with rules, and a footer with
 * page numbers. Content is written at a comfortable, readable size; only if it
 * would genuinely overflow one page is the font gently reduced (never below a
 * readable minimum) so the report never looks cramped.
 */
export function generateReportPdf(sections, meta = {}) {
  let bodySize = 10.5;
  let doc = buildDoc(bodySize, sections, meta);
  while (doc.internal.getNumberOfPages() > 1 && bodySize > 9) {
    bodySize -= 0.5;
    doc = buildDoc(bodySize, sections, meta);
  }
  doc.save(`${COMPANY} - Business Performance Report.pdf`);
}
