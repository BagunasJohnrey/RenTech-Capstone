// Local YYYY-MM-DD string (avoids toISOString() UTC offset bug).
export function toLocalYmd(d) {
  const x = new Date(d);
  if (isNaN(x.getTime())) return '';
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// Today's date in local YYYY-MM-DD.
export function todayYmd() {
  return toLocalYmd(new Date());
}

export function customerLabel(c) {
  if (!c) return '';
  if (typeof c === 'object') return c.name || c.contact || c.email || 'Customer';
  return c;
}

export function customerPhone(c, fallback) {
  if (c && typeof c === 'object') return c.phone || c.contact || '';
  return fallback || '';
}

// Build a `tel:` link for a customer phone number. Normalizes PH numbers
// (0917xxx -> +63917xxx); returns null when no usable number exists.
export function customerTelLink(c, fallback) {
  const digits = (customerPhone(c, fallback) || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('0')) return `tel:+63${digits.slice(1)}`;
  if (digits.length === 10) return `tel:+63${digits}`;
  return `tel:+${digits}`;
}

export function itemLabel(i) {
  if (!i) return '';
  if (typeof i === 'object') return i.name || '';
  return i;
}

// Default staff-composed overdue nudge. Shown pre-filled in the manual-SMS
// modal so staff can tweak it per customer before sending. Mirrors the
// `late_return` template: balance in ASCII PHP (never the ₱ glyph), no
// per-day penalty rates, 1 segment.
export function defaultOverdueMessage(tx) {
  const name = customerLabel(tx?.customer);
  const item = itemLabel(tx?.item);
  const due = new Date(tx?.dueDate || tx?.date);
  const days = !isNaN(due.getTime())
    ? Math.max(1, Math.ceil((Date.now() - due.getTime()) / 86400000))
    : 1;
  const bal = Number(tx?.balance);
  const balPart = Number.isFinite(bal)
    ? ` Balance: PHP ${bal.toLocaleString('en-PH', { maximumFractionDigits: 2 })}.`
    : '';
  return `Hi ${name}, your ${item} rental is overdue (${days} day(s)).${balPart} Please return soon. Thank you!`;
}
