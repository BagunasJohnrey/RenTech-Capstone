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

// Semaphore bills 1 credit (~PHP 0.56) per 160-character segment. Manual SMS
// composition is hard-capped at one segment so a long message can never
// silently cost the boutique 2+ credits.
export const SMS_MAX_LENGTH = 160;
export const SMS_NOTICE = 'Automated message - do not reply.';
// Item names are capped at 60 in the catalog, but legacy rows can be longer.
// Trimming the SMS label keeps the full template readable in one segment.
export const SMS_ITEM_MAX = 40;

// "Maria Clara Dela Cruz" -> "Maria C." (first name + surname initial). Keeps
// greetings short without losing who the message is for. Suffixes like Jr./III
// are skipped so "Juan Dela Cruz Jr." still becomes "Juan C.".
export function smsShortName(c) {
  const name = c && typeof c === 'object' ? (c.name || '') : String(c || '');
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Customer';
  if (parts.length === 1) return parts[0];
  const suffixes = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);
  let last = parts[parts.length - 1];
  if (suffixes.has(last.toLowerCase()) && parts.length > 2) last = parts[parts.length - 2];
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

// Append the "do not reply" notice (once) and keep the whole message inside one
// GSM segment. When trimming is needed the notice is preserved and the body is
// shortened, so the recipient always knows replies are not read.
export function fitSms(message) {
  let text = String(message ?? '').trim();
  if (!/automated message/i.test(text)) text = `${text} ${SMS_NOTICE}`.trim();
  if (text.length <= SMS_MAX_LENGTH) return text;
  const noticeAt = text.toLowerCase().lastIndexOf(SMS_NOTICE.toLowerCase());
  const notice = noticeAt >= 0 ? text.slice(noticeAt).trim() : '';
  const head = (noticeAt >= 0 ? text.slice(0, noticeAt) : text).trimEnd();
  const room = SMS_MAX_LENGTH - (notice ? notice.length + 1 : 0) - 3;
  if (room <= 0) return (notice || text).slice(0, SMS_MAX_LENGTH);
  return `${head.slice(0, room).trimEnd()}...${notice ? ` ${notice}` : ''}`;
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

// SMS-safe item label: ASCII ellipsis (never "…", which is non-GSM-7 and would
// force UCS-2 encoding, halving the per-segment budget) and a hard cap.
export function smsItemLabel(i) {
  const text = itemLabel(i).trim();
  if (text.length <= SMS_ITEM_MAX) return text;
  return `${text.slice(0, SMS_ITEM_MAX - 3).trimEnd()}...`;
}

// What the staff SMS action should say for THIS booking. Payment-proof wording
// is opt-in: ONLY the explicit "send SMS for payment" action (the awaiting-proof
// row) passes { payment: true }. A generic reminder on an overdue booking must
// never claim a payment screenshot is missing just because its manual-QR
// downpayment is still outstanding. A due date in the future must never produce
// an "overdue (1 day)" message, Reserved rows get a pickup reminder, and only
// genuinely past-due rows get the overdue wording.
export function smsIntent(tx, opts = {}) {
  const paid = Number(tx?.totalPaid ?? 0);
  const dp = Number(tx?.downpayment ?? 0);
  // Same fallback as the customer Home: a booking with no gateway and an
  // uncredited downpayment is a manual-QR checkout, even if the row omitted
  // `paymentPath` (the awaiting-proof payload historically did).
  const manual = tx?.paymentPath === 'manual' || tx?.gateway === 'manual' || (!tx?.gateway && paid < dp);
  if (opts?.payment === true) {
    const proof = (Array.isArray(tx?.paymentProofs) ? tx.paymentProofs[0] : null) || tx?.latestProof || null;
    if (proof?.status === 'pending') {
      return { kind: 'paymentReview', subtitle: 'Send a payment status update to customer?' };
    }
    if (proof?.status === 'rejected') {
      return { kind: 'paymentRejected', subtitle: 'Send a re-upload reminder to customer?' };
    }
    if (manual && paid < dp) {
      return { kind: 'paymentMissing', subtitle: 'Send a payment-proof reminder to customer?' };
    }
  }

  const due = new Date(tx?.dueDate || tx?.date);
  if (!isNaN(due.getTime())) {
    const dueDay = new Date(due);
    dueDay.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (tx?.status === 'Overdue' || dueDay < today) {
      return { kind: 'overdue', subtitle: 'Send overdue reminder to customer?' };
    }
  } else if (tx?.status === 'Overdue') {
    return { kind: 'overdue', subtitle: 'Send overdue reminder to customer?' };
  }

  if (tx?.status === 'Reserved') {
    return { kind: 'pickup', subtitle: 'Send pickup reminder to customer?' };
  }
  return { kind: 'due', subtitle: 'Send rental reminder to customer?' };
}

const smsDate = (value) => {
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const smsBalance = (tx) => {
  const bal = Number(tx?.balance);
  return Number.isFinite(bal)
    ? ` Balance: PHP ${bal.toLocaleString('en-PH', { maximumFractionDigits: 2 })}.`
    : '';
};

export function defaultSmsMessage(tx, opts = {}) {
  const name = smsShortName(tx?.customer);
  const item = smsItemLabel(tx?.item);
  const intent = smsIntent(tx, opts);

  if (intent.kind.startsWith('payment')) {
    if (intent.kind === 'paymentReview') {
      return fitSms(`Hi ${name}, we received your payment screenshot for ${item}. It is under review. Thank you!`);
    }
    if (intent.kind === 'paymentRejected') {
      return fitSms(`Hi ${name}, payment for ${item} was not verified. Re-upload in My Rentals. Thank you!`);
    }
    return fitSms(`Hi ${name}, ${item} needs your payment screenshot. Upload it in My Rentals. Thank you!`);
  }

  if (intent.kind === 'overdue') {
    const due = new Date(tx?.dueDate || tx?.date);
    const days = !isNaN(due.getTime())
      ? Math.max(1, Math.ceil((Date.now() - due.getTime()) / 86400000))
      : 1;
    return fitSms(`Hi ${name}, ${item} is overdue (${days} day(s)).${smsBalance(tx)} Please return soon. Thank you!`);
  }

  if (intent.kind === 'pickup') {
    const when = smsDate(tx?.rentalDate || tx?.date);
    return fitSms(`Hi ${name}, pickup for ${item} is on${when ? ` ${when}` : ''}.${smsBalance(tx)} Thank you!`);
  }

  const dueText = smsDate(tx?.dueDate || tx?.date);
  return fitSms(`Hi ${name}, your ${item} is due${dueText ? ` on ${dueText}` : ''}.${smsBalance(tx)} Thank you!`);
}

// Backwards-compatible alias for callers that still name the overdue action.
export function defaultOverdueMessage(tx) {
  return defaultSmsMessage(tx);
}
