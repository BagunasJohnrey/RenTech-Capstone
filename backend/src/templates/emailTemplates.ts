// Branded transactional email templates for Brevo delivery.
//
// Design mirrors the RenTech app theme (see frontend/src/index.css +
// component classes):
//   - Font: 'Plus Jakarta Sans' with system fallbacks (Gmail strips webfonts,
//     so the stack degrades gracefully; Apple Mail loads the <link> font).
//   - Page: #fafbfc (same as the auth screens); card: white, 24px radius
//     (rounded-3xl, like app modals), hairline #eef0f2 border.
//   - Header: maroon gradient #8e323a → #a63f47 → #bf4a53 (same stops as the
//     NotificationsDropdown), extrabold tracking-tight "RenTech" wordmark,
//     white/70 tagline, and a rounded-full status chip (like app pills).
//   - Body: 11px bold uppercase eyebrow label in #bf4a53 (app section-label
//     style), 24px extrabold tracking-tight gray-900 heading, 15px/1.7
//     gray-600 paragraphs with 16px rhythm.
//   - CTA: rounded-full gradient pill (app primary-button style:
//     #b33842 → #bf4a53 → #d97079), solid #bf4a53 bgcolor fallback for
//     Outlook, which ignores gradients and border-radius.
//   - Detail rows: BookingReceipt style — gray-500 label, bold gray-900
//     value, hairline dividers, optional #bf4a53 total row.
//   - Booking code: mono, letterspaced, rounded-full tinted chip (app style).
//   - Callouts (expiry / ignore notices): gray-50 rounded boxes.
//   - Footer: "Mylene's Boutique" + "RenTech · Balayan, Batangas".
//
// All markup uses INLINE CSS only (Gmail/Outlook/Apple Mail strip <style>).
// Each builder returns { subject, html, text } — text is the plain-text part.

const FONT = "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif";
const BRAND = '#bf4a53';
const INK = '#111827';
const BODY = '#4b5563';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const PAGE_BG = '#fafbfc';
const HAIRLINE = '#eef0f2';
const SOFT_BG = '#f9fafb';

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface ShellOpts {
  /** Small uppercase label above the heading, e.g. "Email verification". */
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  preheader?: string;
}

function shell({ eyebrow, heading, bodyHtml, preheader = '' }: ShellOpts): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700;800&amp;display=swap" rel="stylesheet">` +
    `<title>${esc(heading)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:${PAGE_BG};font-family:${FONT};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAGE_BG};padding:32px 16px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid ${HAIRLINE};border-radius:24px;overflow:hidden;">` +
    // Brand header — maroon gradient, wordmark + tagline only.
    `<tr><td bgcolor="#a63f47" style="background:linear-gradient(135deg,#8e323a 0%,#a63f47 50%,#bf4a53 100%);background-color:#a63f47;padding:32px 36px 28px;">` +
    `<p style="margin:0;color:#ffffff;font-size:23px;font-weight:800;letter-spacing:-0.02em;line-height:1.2;font-family:${FONT};">RenTech</p>` +
    `<p style="margin:5px 0 0;color:rgba(255,255,255,0.78);font-size:12.5px;font-family:${FONT};">Mylene&apos;s Boutique &middot; Rental made elegant.</p>` +
    `</td></tr>` +
    // Body — eyebrow label, heading, content.
    `<tr><td style="padding:34px 36px 30px;">` +
    `<p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND};font-family:${FONT};">${esc(eyebrow)}</p>` +
    `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${INK};font-family:${FONT};">${esc(heading)}</h1>` +
    bodyHtml +
    `</td></tr>` +
    // Footer.
    `<tr><td style="background-color:${SOFT_BG};border-top:1px solid ${HAIRLINE};padding:22px 36px 24px;text-align:center;">` +
    `<p style="margin:0;font-size:13px;font-weight:800;color:${INK};font-family:${FONT};">Mylene&apos;s Boutique</p>` +
    `<p style="margin:5px 0 0;font-size:12px;color:${FAINT};font-family:${FONT};">RenTech &middot; Balayan, Batangas &middot; Rental made elegant.</p>` +
    `</td></tr>` +
    `</table>` +
    `<p style="font-size:11px;color:#c3c7cd;text-align:center;margin:14px 0 0;font-family:${FONT};">You&apos;re receiving this because you have a RenTech account or booking.</p>` +
    `</td></tr></table></body></html>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:${BODY};font-family:${FONT};">${esc(text)}</p>`;
}

// Primary CTA — gradient pill with solid fallback for Outlook. The outer
// table is full-width so align="center" truly centers the pill.
function button(url: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td align="center" style="text-align:center;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr>` +
    `<td bgcolor="${BRAND}" style="border-radius:999px;background:linear-gradient(90deg,#b33842 0%,#bf4a53 50%,#d97079 100%);background-color:${BRAND};">` +
    `<a href="${esc(url)}" style="display:inline-block;padding:14px 42px;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:0.01em;font-family:${FONT};">${esc(label)}</a>` +
    `</td></tr></table>` +
    `</td></tr></table>`;
}

// Muted callout box for expiry notices, ignore-notes, and raw link fallback.
function callout(linesHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${SOFT_BG};border:1px solid ${HAIRLINE};border-radius:14px;margin:4px 0 0;">` +
    `<tr><td style="padding:15px 18px;font-size:12.5px;line-height:1.65;color:${MUTED};font-family:${FONT};">${linesHtml}</td></tr></table>`;
}

function calloutLine(text: string): string {
  return `<p style="margin:0 0 6px;font-family:${FONT};">${esc(text)}</p>`;
}

function rawLinkRow(url: string): string {
  return `<p style="margin:8px 0 0;word-break:break-all;font-family:${FONT};">Or paste this link into your browser:<br>` +
    `<a href="${esc(url)}" style="color:${BRAND};font-weight:700;">${esc(url)}</a></p>`;
}

type DetailRow = [label: string, value: string];

// BookingReceipt-style rows; set accentLast to render the final row (totals)
// in brand color, like the app's total row.
function detailsTable(rows: DetailRow[], accentLast = false): string {
  const body = rows.map(([k, v], i) => {
    const last = i === rows.length - 1;
    const border = last ? '' : `border-bottom:1px solid #f4f5f7;`;
    const valueColor = accentLast && last ? BRAND : INK;
    const valueSize = accentLast && last ? 'font-size:15px;' : 'font-size:13.5px;';
    return `<tr>` +
      `<td style="padding:11px 20px;font-size:13px;color:${MUTED};${border}font-family:${FONT};">${esc(k)}</td>` +
      `<td align="right" style="padding:11px 20px;${valueSize}color:${valueColor};font-weight:800;text-align:right;${border}font-family:${FONT};">${esc(v)}</td>` +
      `</tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid ${HAIRLINE};border-radius:16px;margin:20px 0;overflow:hidden;">${body}</table>`;
}

// Centered mono booking-code chip (app pill style).
function codeChip(code: string): string {
  return `<div style="text-align:center;margin:22px 0 4px;">` +
    `<span style="display:inline-block;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:13px;font-weight:700;letter-spacing:0.14em;color:${BRAND};background-color:#fdf0f1;border:1px solid #f6cdd1;border-radius:999px;padding:10px 26px;">${esc(code)}</span>` +
    `</div>`;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

// ---- Signup verification (24h expiry) ----
export function verificationEmail(name: string, verifyUrl: string): BuiltEmail {
  const safeName = name?.trim() || 'there';
  const html = shell({
    eyebrow: 'Email verification',
    heading: `Welcome to RenTech, ${safeName}!`,
    preheader: 'Verify your RenTech email address',
    bodyHtml:
      para('Click below to verify your email and start browsing our collection.') +
      button(verifyUrl, 'Verify My Email') +
      callout(
        calloutLine('This link expires in 24 hours.') +
        calloutLine('Didn\u2019t create an account? You can safely ignore this email.') +
        rawLinkRow(verifyUrl),
      ),
  });
  return {
    subject: 'Verify your RenTech email address',
    html,
    text: `Welcome to RenTech, ${safeName}!\n\nVerify your email to start browsing our collection:\n${verifyUrl}\n\nThis link expires in 24 hours. Didn't create an account? You can safely ignore this email.\n\nRenTech · Balayan, Batangas`,
  };
}

// ---- Password reset (1h expiry) ----
export function passwordResetEmail(name: string, resetUrl: string): BuiltEmail {
  const safeName = name?.trim() || 'there';
  const html = shell({
    eyebrow: 'Account security',
    heading: `Reset your password, ${safeName}`,
    preheader: 'Reset your RenTech password',
    bodyHtml:
      para('We received a request to reset your password. Click below to choose a new one.') +
      button(resetUrl, 'Reset Password') +
      callout(
        calloutLine('This link expires in 1 hour.') +
        calloutLine('Didn\u2019t request this? You can safely ignore this email \u2014 your password won\u2019t change until you create a new one.') +
        rawLinkRow(resetUrl),
      ),
  });
  return {
    subject: 'Reset your RenTech password',
    html,
    text: `Hi ${safeName},\n\nWe received a request to reset your password. Choose a new one here:\n${resetUrl}\n\nThis link expires in 1 hour. Didn't request this? You can safely ignore this email.\n\nRenTech · Balayan, Batangas`,
  };
}

export interface BookingDetails {
  customerName: string;
  itemName: string;
  pickupDate: string;
  dueDate: string;
  rentalFee: number;
  downpayment: number;
  balance: number;
  bookingCode?: string;
  qrCodeDataUri?: string;
  // Manual-QR booking whose screenshot is still awaiting staff verification.
  paymentPending?: boolean;
}

function peso(n: number): string {
  return `\u20B1${Number(n || 0).toLocaleString('en-PH')}`;
}

// ---- Order confirmation (booking created) ----
export function bookingConfirmationEmail(d: BookingDetails): BuiltEmail {
  const pending = d.paymentPending === true;
  const html = shell({
    eyebrow: pending ? 'Booking received' : 'Order confirmation',
    heading: pending
      ? `We received your booking, ${d.customerName}!`
      : `Your rental is confirmed, ${d.customerName}!`,
    preheader: pending
      ? `Your payment screenshot is under review`
      : `Your rental of ${d.itemName} is confirmed`,
    bodyHtml:
      (pending
        ? para(`\u201C${d.itemName}\u201D is reserved for you. Our team is verifying your downpayment screenshot; we\u2019ll email you as soon as it\u2019s approved.`)
        : para(`\u201C${d.itemName}\u201D is reserved for you. Please pick it up on ${d.pickupDate} and return it by ${d.dueDate}.`)) +
      (d.bookingCode ? codeChip(d.bookingCode) : '') +
      (d.qrCodeDataUri
        ? `<div style="text-align:center;margin:18px 0 4px;"><img src="${d.qrCodeDataUri}" alt="Booking QR Code" width="160" height="160" style="border-radius:12px;display:block;margin:0 auto;" /></div><p style="text-align:center;font-size:11px;color:${MUTED};margin:6px 0 18px;font-family:${FONT};">Scan to open this booking</p>`
        : '') +
      detailsTable([
        ['Item', d.itemName],
        ['Pickup', d.pickupDate],
        ['Return by', d.dueDate],
        ['Rental fee', peso(d.rentalFee)],
        ['Downpayment', pending ? `${peso(d.downpayment)} (under review)` : peso(d.downpayment)],
        ['Balance', peso(d.balance)],
      ], true) +
      para(pending
        ? 'No action needed right now. We will email you once the payment is verified; the item is released only after the balance is settled.'
        : 'Show this email (or your booking code) at the boutique when you pick up. See you soon!'),
  });
  return {
    subject: pending
      ? `Booking received \u2014 payment under review: ${d.itemName}`
      : `Booking confirmed: ${d.itemName}`,
    html,
    text: pending
      ? `Hi ${d.customerName},\n\nWe received your booking for "${d.itemName}".\nYour downpayment screenshot is under review. We'll email you once it's verified.\nPickup: ${d.pickupDate}\nReturn by: ${d.dueDate}\nRental fee: ${peso(d.rentalFee)}\nDownpayment under review: ${peso(d.downpayment)}\nBalance: ${peso(d.balance)}${d.bookingCode ? `\nBooking code: ${d.bookingCode}` : ''}\n\nRenTech · Balayan, Batangas`
      : `Hi ${d.customerName},\n\nYour rental of "${d.itemName}" is confirmed.\nPickup: ${d.pickupDate}\nReturn by: ${d.dueDate}\nRental fee: ${peso(d.rentalFee)}\nDownpayment: ${peso(d.downpayment)}\nBalance: ${peso(d.balance)}${d.bookingCode ? `\nBooking code: ${d.bookingCode}` : ''}\n\nShow this email at the boutique when you pick up. Thank you!\n\nRenTech · Balayan, Batangas`,
  };
}

// ---- Order pickup (item released) ----
export function pickupEmail(customerName: string, itemName: string, dueDate: string): BuiltEmail {
  const html = shell({
    eyebrow: 'Order pickup',
    heading: `Enjoy your rental, ${customerName}!`,
    preheader: `You picked up ${itemName} — due back ${dueDate}`,
    bodyHtml:
      para(`You picked up \u201C${itemName}\u201D. Please return it by ${dueDate} so the next customer isn\u2019t kept waiting.`) +
      detailsTable([['Item', itemName], ['Return by', dueDate]]) +
      para('Need more time? Contact the boutique before your due date to arrange an extension.'),
  });
  return {
    subject: `Picked up: ${itemName} — due ${dueDate}`,
    html,
    text: `Hi ${customerName},\n\nYou picked up "${itemName}". Please return it by ${dueDate}.\nNeed more time? Contact the boutique before your due date.\n\nRenTech · Balayan, Batangas`,
  };
}

// ---- Order return (thank-you + charges) ----
export function returnEmail(
  customerName: string,
  itemName: string,
  opts: { latePenalty?: number; damageFee?: number; damageReason?: string | null } = {},
): BuiltEmail {
  const late = opts.latePenalty || 0;
  const damage = opts.damageFee || 0;
  const extra = late + damage;
  const rows: DetailRow[] = [['Item', itemName]];
  if (late > 0) rows.push(['Late penalty', peso(late)]);
  if (damage > 0) rows.push(['Damage fee', peso(damage)]);
  if (opts.damageReason) rows.push(['Damage note', opts.damageReason]);
  const html = shell({
    eyebrow: 'Order return',
    heading: `Thank you, ${customerName}!`,
    preheader: `Thanks for returning ${itemName}`,
    bodyHtml:
      para(`\u201C${itemName}\u201D has been returned${extra > 0 ? ` with additional charges of ${peso(extra)}` : ''}. We hope you loved wearing it!`) +
      (rows.length > 1 ? detailsTable(rows, true) : '') +
      para('We\u2019d love to style you again \u2014 browse the latest collection any time.'),
  });
  return {
    subject: `Thanks for returning ${itemName}!`,
    html,
    text: `Hi ${customerName},\n\n"${itemName}" has been returned${extra > 0 ? ` with additional charges of ${peso(extra)}` : ''}. Thank you — we hope you loved wearing it!\n\nRenTech · Balayan, Batangas`,
  };
}

// ---- Booking cancellation ----
export function cancellationEmail(customerName: string, itemName: string): BuiltEmail {
  const html = shell({
    eyebrow: 'Booking update',
    heading: `Booking cancelled, ${customerName}`,
    preheader: `Your booking for ${itemName} was cancelled`,
    bodyHtml:
      para(`Your booking for \u201C${itemName}\u201D has been cancelled and the item is back in the collection.`) +
      para('Changed your mind? You\u2019re always welcome to book again.'),
  });
  return {
    subject: `Booking cancelled: ${itemName}`,
    html,
    text: `Hi ${customerName},\n\nYour booking for "${itemName}" has been cancelled and the item is back in the collection.\n\nRenTech · Balayan, Batangas`,
  };
}

// ---- Payment proof rejected ----
export function proofRejectedEmail(customerName: string, itemName: string, reason: string): BuiltEmail {
  const safeName = customerName?.trim() || 'there';
  const html = shell({
    eyebrow: 'Payment review',
    heading: `We couldn't verify your payment, ${safeName}`,
    preheader: `Your payment proof for ${itemName} needs to be re-uploaded`,
    bodyHtml:
      para(`We reviewed the payment screenshot for \u201C${itemName}\u201D but couldn't verify it.`) +
      detailsTable([
        ['Item', itemName],
        ['Reason', reason],
      ], true) +
      para('Please upload a new proof from My Rentals so we can confirm your booking. Pickup stays on hold until the downpayment is verified.'),
  });
  return {
    subject: `Payment proof needs attention: ${itemName}`,
    html,
    text: `Hi ${safeName},\n\nWe couldn't verify your payment proof for "${itemName}".\nReason: ${reason}\n\nPlease upload a new proof from My Rentals. Pickup stays on hold until the downpayment is verified.\n\nRenTech · Balayan, Batangas`,
  };
}

// ---- Due-today reminder ----
export function dueReminderEmail(customerName: string, itemName: string, dueDate: string): BuiltEmail {
  const html = shell({
    eyebrow: 'Gentle reminder',
    heading: `Friendly reminder, ${customerName}`,
    preheader: `Your rental of ${itemName} is due today`,
    bodyHtml:
      para(`Your rental of \u201C${itemName}\u201D is due today (${dueDate}). See you at the boutique!`) +
      detailsTable([['Item', itemName], ['Due', dueDate]]),
  });
  return {
    subject: `Due today: ${itemName}`,
    html,
    text: `Hi ${customerName},\n\nA reminder that your rental of "${itemName}" is due today (${dueDate}). See you at the boutique!\n\nRenTech · Balayan, Batangas`,
  };
}

// ---- Overdue notice (no fee amounts — policy: fee-free reminder text) ----
export function overdueEmail(customerName: string, itemName: string, daysOverdue: number): BuiltEmail {
  const html = shell({
    eyebrow: 'Overdue notice',
    heading: `Your rental is overdue, ${customerName}`,
    preheader: `Your rental of ${itemName} is overdue`,
    bodyHtml:
      para(`Your rental of \u201C${itemName}\u201D is now ${daysOverdue} day(s) overdue. Please return it as soon as possible.`) +
      detailsTable([['Item', itemName], ['Days overdue', String(daysOverdue)]]) +
      para('Please contact the boutique to arrange a return.'),
  });
  return {
    subject: `Overdue: please return ${itemName}`,
    html,
    text: `Hi ${customerName},\n\nYour rental of "${itemName}" is now ${daysOverdue} day(s) overdue. Please return it as soon as possible or contact the boutique.\n\nRenTech · Balayan, Batangas`,
  };
}

// ---- Staff welcome (admin-created account, one-time password) ----
export function staffWelcomeEmail(name: string, oneTimePassword: string): BuiltEmail {
  const html = shell({
    eyebrow: 'Welcome aboard',
    heading: `Welcome to the team, ${name}!`,
    preheader: 'Your RenTech staff account is ready',
    bodyHtml:
      para('An admin created a staff account for you. Use this one-time password to sign in for the first time \u2014 you will be asked to choose your own password right away.') +
      codeChip(oneTimePassword) +
      callout(calloutLine('Keep this password private. If you didn\u2019t expect this email, contact your admin.')),
  });
  return {
    subject: 'Your RenTech staff account is ready',
    html,
    text: `Hi ${name},\n\nAn admin created a staff account for you. Your one-time password is: ${oneTimePassword}\n\nSign in with it once — you will be asked to choose your own password right away. Keep it private.\n\nRenTech · Balayan, Batangas`,
  };
}
