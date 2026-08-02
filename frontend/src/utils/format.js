export function customerLabel(c) {
  if (!c) return '';
  if (typeof c === 'object') return c.name || c.contact || c.email || 'Customer';
  return c;
}

export function customerPhone(c, fallback) {
  if (c && typeof c === 'object') return c.phone || c.contact || '';
  return fallback || '';
}

export function itemLabel(i) {
  if (!i) return '';
  if (typeof i === 'object') return i.name || '';
  return i;
}
