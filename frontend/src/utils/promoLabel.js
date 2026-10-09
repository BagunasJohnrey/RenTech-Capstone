// Shared voucher label helpers — one wording everywhere a promo is shown
// (checkout row, public list, dashboard offers, settings tickets, manager).

// Headline discount: "₱200 off" for fixed-amount codes, "15% off" for percent.
export function promoDiscountLabel(p) {
  if (p?.discountAmount != null) return `₱${Number(p.discountAmount).toLocaleString()} off`;
  if (p?.discountPct != null) return `${p.discountPct}% off`;
  return 'Discount';
}

// Short headline for tight spaces (stubs, badges): "-₱200" / "-15%".
export function promoShortLabel(p) {
  if (p?.discountAmount != null) return `-₱${Number(p.discountAmount).toLocaleString()}`;
  if (p?.discountPct != null) return `-${p.discountPct}%`;
  return '−';
}

// One-line terms: min spend, category scope, first-timer, start date.
export function promoTermsLabel(p) {
  if (!p) return '';
  const bits = [];
  if (p.minSpend != null) bits.push(`min ₱${Number(p.minSpend).toLocaleString()}`);
  if (p.appliesToCategories?.length) bits.push(p.appliesToCategories.join(' · '));
  if (p.firstBookingOnly) bits.push('first booking');
  if (p.startsAt && new Date(p.startsAt) > new Date()) {
    bits.push(`from ${new Date(p.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  }
  return bits.join(' · ');
}
