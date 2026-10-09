import QRCode from 'qrcode';
import { getBookingCode, txDownpayment, txBalance } from './receipt';

// Shared PNG booking-receipt renderer (system branding: Plus Jakarta Sans,
// burgundy gradient letterhead, logo, RENTECH. wordmark). Drawn on canvas —
// no new dependencies and works on mobile browsers. Used by the customer
// booking flow and the staff walk-in flow so both download the same receipt.
export async function downloadReceiptImage({
  tx,
  itemName,
  customerName,
  size,
  notes,
  pickupLabel,
  eventLabel,
  dueLabel,
  showQr = true,
  qrDataUri = null,
}) {
  if (!tx) return;
  try { await document.fonts?.ready; } catch { /* fall back to Arial */ }
  const loadImage = (src, timeoutMs = 2500) => new Promise((resolve) => {
    const img = new Image();
    const done = (v) => resolve(v);
    const timer = setTimeout(() => done(null), timeoutMs);
    img.onload = () => { clearTimeout(timer); done(img); };
    img.onerror = () => { clearTimeout(timer); done(null); };
    img.src = src;
  });
  const logo = await loadImage('/pwa-192x192.png');
  const code = getBookingCode(tx);
  // QR only when the feature flag is on: reuse a passed-in data URI when
  // ready, otherwise generate it so the saved image stays scannable.
  let qrImg = null;
  if (showQr) {
    let qrUrl = qrDataUri || tx.qrCodeDataUri || null;
    if (!qrUrl) {
      try { qrUrl = await QRCode.toDataURL(code, { width: 368, margin: 1, errorCorrectionLevel: 'M' }); } catch { qrUrl = null; }
    }
    if (qrUrl) qrImg = await loadImage(qrUrl);
  }
  const peso = (n) => `₱${Number(n || 0).toLocaleString()}`;
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const F = (w, s, mono) => `${w} ${s}px ${mono ? '"Plus Jakarta Sans", monospace, Arial' : '"Plus Jakarta Sans", Arial, sans-serif'}`;
  const rows = [
    ['Item', itemName || tx.item?.name || '—', 'bold'],
    ['Pickup', pickupLabel || '—', ''],
    ['Event Date', eventLabel || '—', 'bold'],
    ['Return By', dueLabel || '—', 'accent'],
    ['Customer', customerName || tx.customer?.name || '—', 'bold'],
    ['Size', size || tx.size || '—', ''],
  ];
  if (notes) rows.push(['Notes', notes, '']);
  const S = 2, W = 600, M = 24, PAD = 28, LH = 28;
  const cardX = M, cardW = W - M * 2;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const wrap = (text, font, maxW) => {
    ctx.font = font;
    const words = String(text ?? '—').split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
      else line = t;
    }
    if (line) lines.push(line);
    return lines;
  };
  const labelW = 150, gap = 16, valW = cardW - PAD * 2 - labelW - gap;
  const measured = rows.map(([k, v, style]) => ({ k, style, lines: wrap(v, F(800, 19), valW) }));
  // Settle-at-pickup caption under the totals band (only when a balance remains).
  const settleBal = Number(txBalance(tx)) || 0;
  ctx.font = F(600, 14);
  const settleLines = settleBal > 0 ? wrap(`Please settle the remaining ${peso(settleBal)} at pickup — released only when fully paid.`, F(600, 14), cardW - PAD * 2) : [];
  const settleH = settleLines.length ? settleLines.length * 20 : 0;
  const headerH = 178;
  const rowsH = measured.reduce((h, r) => h + Math.max(r.lines.length, 1) * LH + 26, 0);
  // Dark pickup-pass panel (QR plate + code + caption) replaces the old
  // centered-QR + pill + caption stack.
  const passH = 248;
  const H = M + headerH + 30 + 64 + 30 + 24 + 30 + rowsH + 20 + 108 + settleH + 30 + passH + 30 + 60 + M;
  cv.width = W * S;
  cv.height = H * S;
  ctx.scale(S, S);
  // Page backdrop
  ctx.fillStyle = '#fcfcfd';
  ctx.fillRect(0, 0, W, H);
  const cardY = M, cardH = H - M * 2;
  // Card base
  rr(cardX, cardY, cardW, cardH, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#f1f2f4';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Gradient letterhead clipped to the card's top corners
  ctx.save();
  rr(cardX, cardY, cardW, cardH, 28);
  ctx.clip();
  const grad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
  grad.addColorStop(0, '#8e323a');
  grad.addColorStop(0.5, '#a63f47');
  grad.addColorStop(1, '#bf4a53');
  ctx.fillStyle = grad;
  ctx.fillRect(cardX, cardY, cardW, headerH);
  ctx.restore();
  const hx = cardX + PAD, hy = cardY + 36;
  // Logo in a white ring
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx + 32, hy + 32, 32, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(logo, hx, hy, 64, 64);
    ctx.restore();
  }
  const tx0 = hx + (logo ? 80 : 0);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = F(800, 27);
  ctx.fillText("Mylene's Boutique", tx0, hy + 26);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = F(500, 16);
  ctx.fillText('Rental Attire & Formal Wear', tx0, hy + 50);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('Balayan, Batangas, Philippines', tx0, hy + 70);
  // Receipt meta, right-aligned
  ctx.textAlign = 'right';
  const rx = cardX + cardW - PAD;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = F(800, 14);
  ctx.fillText('BOOKING RECEIPT', rx, hy + 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = F(800, 22, true);
  ctx.fillText(code, rx, hy + 36);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = F(500, 14);
  ctx.fillText(today, rx, hy + 58);
  // Confirmed title with emerald check badge
  let y = cardY + headerH + 30;
  const cy = y + 22;
  ctx.beginPath();
  ctx.arc(cardX + PAD + 26, cy, 26, 0, Math.PI * 2);
  ctx.fillStyle = '#ecfdf5';
  ctx.fill();
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cardX + PAD + 14, cy + 1);
  ctx.lineTo(cardX + PAD + 23, cy + 10);
  ctx.lineTo(cardX + PAD + 39, cy - 9);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111827';
  ctx.font = F(800, 29);
  ctx.fillText('Booking Confirmed!', cardX + PAD + 64, y + 24);
  ctx.fillStyle = '#6b7280';
  ctx.font = F(500, 17);
  ctx.fillText('Your reservation has been secured.', cardX + PAD + 64, y + 50);
  y += 64 + 30;
  // Section label with burgundy rule
  ctx.fillStyle = '#bf4a53';
  ctx.fillRect(cardX + PAD, y, 4, 18);
  ctx.fillStyle = '#6b7280';
  ctx.font = F(800, 13);
  ctx.fillText('R E S E R V A T I O N   D E T A I L S', cardX + PAD + 12, y + 14);
  y += 30;
  // Detail rows with hairline dividers (values wrap, never crop)
  for (const r of measured) {
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(cardX + PAD, y, cardW - PAD * 2, 1);
    y += 13;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6b7280';
    ctx.font = F(500, 18);
    ctx.fillText(r.k, cardX + PAD, y + 20);
    ctx.textAlign = 'right';
    ctx.font = F(800, 19);
    ctx.fillStyle = r.style === 'accent' ? '#bf4a53' : '#111827';
    r.lines.forEach((ln, i) => ctx.fillText(ln, cardX + cardW - PAD, y + 20 + i * LH));
    y += Math.max(r.lines.length, 1) * LH + 13;
  }
  y += 20;
  // Totals band
  const boxH = 108;
  rr(cardX + PAD, y, cardW - PAD * 2, boxH, 16);
  ctx.fillStyle = '#fdf2f3';
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6b7280';
  ctx.font = F(600, 18);
  ctx.fillText('Paid now', cardX + PAD + 18, y + 40);
  ctx.fillText('Due at pickup', cardX + PAD + 18, y + 76);
  ctx.textAlign = 'right';
  ctx.font = F(800, 21);
  ctx.fillStyle = '#bf4a53';
  ctx.fillText(peso(txDownpayment(tx)), cardX + cardW - PAD - 18, y + 40);
  ctx.fillStyle = '#111827';
  ctx.fillText(peso(txBalance(tx)), cardX + cardW - PAD - 18, y + 76);
  y += boxH;
  if (settleLines.length) {
    y += 14;
    ctx.textAlign = 'center';
    ctx.font = F(600, 14);
    ctx.fillStyle = '#92400e';
    settleLines.forEach((ln, i) => ctx.fillText(ln, W / 2, y + i * 20));
    y += settleLines.length * 20;
  }
  y += 30;
  // Pickup-pass panel: dark ticket with a white QR plate, dashed
  // perforation, booking code and counter note.
  rr(cardX + PAD, y, cardW - PAD * 2, passH, 20);
  const dgrad = ctx.createLinearGradient(0, y, 0, y + passH);
  dgrad.addColorStop(0, '#1f2937');
  dgrad.addColorStop(1, '#111827');
  ctx.fillStyle = dgrad;
  ctx.fill();
  const qbox = 184;
  const qx = cardX + PAD + 24, qy = y + (passH - qbox) / 2;
  let px0 = cardX + PAD + 24;
  if (qrImg) {
    rr(qx, qy, qbox, qbox, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.drawImage(qrImg, qx + 14, qy + 14, qbox - 28, qbox - 28);
    // Perforation between QR and code.
    const dx = qx + qbox + 24;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(dx, y + 26);
    ctx.lineTo(dx, y + passH - 26);
    ctx.stroke();
    ctx.restore();
    px0 = dx + 24;
  }
  const passW = cardX + cardW - PAD - 24 - px0;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = F(800, 13);
  ctx.fillText('P I C K U P   P A S S', tx0, y + 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = F(800, 30, true);
  ctx.fillText(code, px0, y + 96);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  const passLines = wrap('Show this code at the counter — staff scan it to pull up your order.', F(500, 15), passW);
  passLines.slice(0, 3).forEach((ln, i) => ctx.fillText(ln, px0, y + 126 + i * 22));
  y += passH + 30;
  // Footer wordmark
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(cardX + PAD, y, cardW - PAD * 2, 1);
  y += 26;
  ctx.font = F(800, 16);
  const wm = 'RENTECH', dot = '.';
  const wmW = ctx.measureText(wm).width + ctx.measureText(dot).width;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111827';
  ctx.fillText(wm, (W - wmW) / 2, y + 12);
  ctx.fillStyle = '#bf4a53';
  ctx.fillText(dot, (W - wmW) / 2 + ctx.measureText(wm).width, y + 12);
  const a = document.createElement('a');
  a.href = cv.toDataURL('image/png');
  a.download = `receipt-${code}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
