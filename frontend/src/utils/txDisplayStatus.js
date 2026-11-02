import { TX_STATUS_PILLS } from './statusColors';
import { todayYmd, toLocalYmd } from './format';

// One status per transaction row. A booking can be in several states at once
// (overdue AND under alteration, reserved AND payment unverified…); lists
// show only the most urgent one so staff read the row at a glance.
//
// Order (most urgent first):
//   Overdue → Payment pending → Due today → Pickup today → Alteration → base status

const pill = (bg, text) => `${bg} ${text}`;

export const DISPLAY_STATUS_STYLE = {
  Overdue: pill(TX_STATUS_PILLS.Overdue.bg, TX_STATUS_PILLS.Overdue.text),
  'Payment pending': 'bg-amber-50 text-amber-700',
  'Due today': 'bg-orange-50 text-orange-700',
  'Pickup today': 'bg-violet-50 text-violet-700',
  'Alteration ready': 'bg-emerald-50 text-emerald-600',
  'Alteration pending': 'bg-amber-50 text-amber-600',
  Active: pill(TX_STATUS_PILLS.Active.bg, TX_STATUS_PILLS.Active.text),
  Reserved: pill(TX_STATUS_PILLS.Reserved.bg, TX_STATUS_PILLS.Reserved.text),
  Returned: pill(TX_STATUS_PILLS.Returned.bg, TX_STATUS_PILLS.Returned.text),
  Cancelled: pill(TX_STATUS_PILLS.Cancelled.bg, TX_STATUS_PILLS.Cancelled.text),
};

// Lower = more urgent. Used for the default "priority" sort.
const RANK = {
  Overdue: 0,
  'Payment pending': 1,
  'Due today': 2,
  'Pickup today': 3,
  'Alteration ready': 4,
  'Alteration pending': 5,
};

// The states that make up the "Priority" filter: something needs doing now.
export const PRIORITY_LABELS = new Set(Object.keys(RANK));

const isOpen = (s) => s === 'Active' || s === 'Reserved' || s === 'Overdue';

// Manual-QR booking whose downpayment proof isn't verified yet.
export const qrPaymentUnresolved = (tx) =>
  (tx?.paymentPath === 'manual' || tx?.gateway === 'manual') &&
  Number(tx?.totalPaid || 0) < Number(tx?.downpayment || 0);

export function displayStatus(tx, today = todayYmd()) {
  const s = tx?.status;
  let label = s || '—';
  if (s === 'Overdue') label = 'Overdue';
  else if (isOpen(s) && qrPaymentUnresolved(tx)) label = 'Payment pending';
  else if (s === 'Active' && tx.dueDate && toLocalYmd(tx.dueDate) === today) label = 'Due today';
  else if (s === 'Reserved' && tx.rentalDate && toLocalYmd(tx.rentalDate) === today) label = 'Pickup today';
  else if (isOpen(s) && tx.alterationStatus) label = tx.alterationStatus === 'ready' ? 'Alteration ready' : 'Alteration pending';
  return {
    label,
    className: DISPLAY_STATUS_STYLE[label] || 'bg-gray-100 text-gray-600',
    priority: label in RANK,
    rank: RANK[label],
  };
}
