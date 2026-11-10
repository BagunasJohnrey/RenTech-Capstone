// Shared voucher label helpers — one wording everywhere a promo is shown
// (checkout row, public list, dashboard offers, settings tickets, manager).

// Headline discount: "₱200 off" for fixed-amount codes, "15% off" for percent,
// "15% off, up to ₱500" for a capped percent code (Shopee wording).
export function promoDiscountLabel(p) {
  if (p?.discountAmount != null) return `₱${Number(p.discountAmount).toLocaleString()} off`;
  if (p?.discountPct != null) {
    return p.maxDiscount != null
      ? `${p.discountPct}% off, up to ₱${Number(p.maxDiscount).toLocaleString()}`
      : `${p.discountPct}% off`;
  }
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

// Shopee-style expiry nudge: "Ends today" / "Ends in 3 days" / "Valid till
// Nov 20". `urgent` is true inside the last 3 days so the UI can colour it.
export function promoExpiry(p) {
  if (!p?.expiresAt) return { label: 'No expiry', urgent: false };
  const end = new Date(p.expiresAt);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(end) - startOf(new Date())) / 86_400_000);
  if (days <= 0) return { label: 'Ends today', urgent: true };
  if (days === 1) return { label: 'Ends tomorrow', urgent: true };
  if (days <= 3) return { label: `Ends in ${days} days`, urgent: true };
  return { label: `Valid till ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, urgent: false };
}
