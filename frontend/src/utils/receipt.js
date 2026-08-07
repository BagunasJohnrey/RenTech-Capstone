// Receipt display helpers. Centralized so every receipt/QR surface computes
// money the same way (and never shows ₱NaN).

export function txRentalFee(tx) {
  return Number(tx?.rentalFee ?? tx?.amount ?? 0) || 0;
}

export function txDownpayment(tx) {
  return Number(tx?.downpayment) || 0;
}

export function txBalance(tx) {
  // Prefer the server-computed balance; fall back to fee - downpayment so
  // pre-payment confirmations (where the server balance may still equal the
  // full fee at that instant) still render a sensible number instead of NaN.
  if (tx?.balance != null && tx.balance !== '' && !Number.isNaN(Number(tx.balance))) {
    return Number(tx.balance);
  }
  return Math.max(0, txRentalFee(tx) - txDownpayment(tx));
}

// Booking code = RT-XXXXXXXX (first 8 hex chars of the UUID, uppercase).
export function getBookingCode(tx) {
  const id = typeof tx === 'string' ? tx : tx?.id;
  return `RT-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`;
