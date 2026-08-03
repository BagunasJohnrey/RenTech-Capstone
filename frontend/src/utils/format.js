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
