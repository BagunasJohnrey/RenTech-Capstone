// Resend transactional email delivery (replaced Brevo — client feedback §3.1).
//
// Plain fetch against the Resend REST API (no SDK dependency), 10s timeout,
// simulated success in dev/test when no key is configured, loud failure in
// production.
//
// Every send is best-effort from the caller's perspective for ORDER emails
// (booking/pickup/return/...) — those helpers never throw for a failed send,
// they log and return null. AUTH emails (verification, reset) DO throw on
// failure so the controller can surface an honest error (a user who never
// receives their link is stuck without one).

import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { isEmailEnabled, isEmailTypeEnabled, getBusinessRules, type EmailType } from './settings.service.js';
import {
  verificationEmail,
  passwordResetEmail,
  bookingConfirmationEmail,
  pickupEmail,
  returnEmail,
  cancellationEmail,
  proofRejectedEmail,
  dueReminderEmail,
  overdueEmail,
  staffWelcomeEmail,
  setEmailStore,
  type BookingDetails,
} from '../templates/emailTemplates.js';

const RESEND_API = process.env.RESEND_API_URL || 'https://api.resend.com';

// Pull the store name / address / inquiry number from Settings → General →
// Business Profile into the templates. getBusinessRules is cached for 60s,
// so this costs nothing per email; any failure keeps the last-known values.
export async function refreshEmailStore(): Promise<void> {
  try {
    const rules = await getBusinessRules();
    setEmailStore({ name: rules.business_name, address: rules.business_address, contact: rules.business_contact });
  } catch {
    /* keep current store identity */
  }
}

export interface SendResult {
  messageId: string | null;
  simulated: boolean;
  delivered: boolean;
}

// Resend takes the sender as one string: "Name <email>". Quotes and angle
// brackets are stripped from the display name so a stray one in the env value
// can't produce a malformed header (Resend 422s those).
export function senderHeader(): string {
  const email = env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const name = (env.RESEND_FROM_NAME || 'RenTech').replace(/[<>"]/g, '').trim();
  return name ? `${name} <${email}>` : email;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

/** Skip placeholder/invalid recipients (walk-in synthetic profiles, blanks). */
export function isSendableEmail(email?: string | null): boolean {
  if (!email) return false;
  if (!isValidEmail(email)) return false;
  // Walk-in profiles use synthetic @rentech.invalid addresses — never email them.
  if (email.toLowerCase().endsWith('@rentech.invalid')) return false;
  return true;
}

// Inline image (CID) attachment: referenced from the HTML as
// `<img src="cid:<contentId>">`. Gmail, Outlook and most webmail strip
// `data:` image URIs, so embedded images must travel as attachments.
export type EmailAttachment = { filename: string; content: string /* base64 */; contentId?: string };

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}): Promise<SendResult> {
  const to = params.to.trim();
  if (!isSendableEmail(to)) {
    throw new AppError(400, 'Invalid recipient email');
  }

  // No key configured -> simulate success in dev/test so every flow works
  // without real email credits. Fail loudly in production: a silently
  // "simulated" verification email would leave the user locked out forever.
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === 'production') {
      throw new AppError(503, 'Email service is not configured');
    }
    return { messageId: `sim_${Date.now()}`, simulated: true, delivered: false };
  }

  let response: Response;
  try {
    response = await fetch(`${RESEND_API}/emails`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: senderHeader(),
        to: [to],
        subject: params.subject,
        html: params.html,
        text: params.text,
        ...(params.attachments?.length
          ? {
              attachments: params.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentId ? { content_id: a.contentId } : {}),
              })),
            }
          : {}),
      }),
    });
  } catch (err) {
    console.error('[resend] send failed (network):', (err as Error)?.message);
    throw new AppError(502, 'Email service is unavailable. Please try again later.');
  }

  if (!response.ok) {
    // Log the upstream body server-side but never forward it (may echo PII).
    const errorBody = await response.text().catch(() => '');
    console.error('[resend] send failed:', response.status, errorBody.slice(0, 500));
    // 401 = bad key; 403 = sending domain not verified / testing-only key.
    if (response.status === 401 || response.status === 403) {
      throw new AppError(500, 'Email service rejected the request. Please contact the boutique.');
    }
    if (response.status === 429) {
      throw new AppError(429, 'Email service is busy. Please wait a few minutes and try again.');
    }
    throw new AppError(502, 'Could not send the email. Please try again later.');
  }

  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { messageId: data?.id ?? null, simulated: false, delivered: true };
}

/** Order/lifecycle emails: best-effort — log + swallow so email never blocks a booking. */
async function sendBestEffort(
  to: string,
  built: { subject: string; html: string; text: string; attachments?: EmailAttachment[] },
  type?: EmailType,
): Promise<SendResult | null> {
  if (!isSendableEmail(to)) return null;
  // Global kill-switch (admin Integrations tab) plus the per-type toggles in
  // Settings → Notifications. Auth emails bypass both (they call sendEmail
  // directly) so verification/reset always work.
  try {
    if (!(await isEmailEnabled())) return null;
    if (type && !(await isEmailTypeEnabled(type))) return null;
  } catch {
    // fail-open: if the flags can't be read, attempt the send as before
  }
  try {
    return await sendEmail({ to, ...built });
  } catch (err) {
    console.error('[resend] lifecycle email skipped:', (err as Error)?.message);
    return null;
  }
}

// ---- Auth emails (throw on failure — caller surfaces the error) ----

export async function sendVerificationEmail(to: string, name: string, verifyUrl: string) {
  await refreshEmailStore();
  return sendEmail({ to, ...verificationEmail(name, verifyUrl) });
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string) {
  await refreshEmailStore();
  return sendEmail({ to, ...passwordResetEmail(name, resetUrl) });
}

export async function sendStaffWelcomeEmail(to: string, name: string, oneTimePassword: string) {
  await refreshEmailStore();
  return sendBestEffort(to, staffWelcomeEmail(name, oneTimePassword));
}

// ---- Order emails (best-effort — never block the rental flow) ----

export const BOOKING_QR_CID = 'booking-qr';

export async function sendBookingConfirmationEmail(to: string, details: BookingDetails) {
  await refreshEmailStore();
  // Ship the QR as an inline attachment (cid:) instead of a data: URI, which
  // Gmail and most email apps block — the QR used to show as a broken image.
  const match = /^data:image\/png;base64,(.+)$/.exec(details.qrCodeDataUri ?? '');
  if (!match) {
    return sendBestEffort(to, bookingConfirmationEmail({ ...details, qrCodeDataUri: undefined }), 'booking');
  }
  const built = bookingConfirmationEmail({ ...details, qrCodeDataUri: `cid:${BOOKING_QR_CID}` });
  return sendBestEffort(
    to,
    { ...built, attachments: [{ filename: 'booking-qr.png', content: match[1], contentId: BOOKING_QR_CID }] },
    'booking',
  );
}

export async function sendPickupEmail(to: string, customerName: string, itemName: string, dueDate: string) {
  await refreshEmailStore();
  return sendBestEffort(to, pickupEmail(customerName, itemName, dueDate), 'pickup');
}

export async function sendReturnEmail(
  to: string,
  customerName: string,
  itemName: string,
  opts?: { latePenalty?: number; damageFee?: number; damageReason?: string | null },
) {
  await refreshEmailStore();
  return sendBestEffort(to, returnEmail(customerName, itemName, opts), 'return');
}

export async function sendCancellationEmail(to: string, customerName: string, itemName: string) {
  await refreshEmailStore();
  return sendBestEffort(to, cancellationEmail(customerName, itemName), 'cancellation');
}

export async function sendProofRejectedEmail(to: string, customerName: string, itemName: string, reason: string) {
  await refreshEmailStore();
  return sendBestEffort(to, proofRejectedEmail(customerName, itemName, reason), 'payment');
}

export async function sendDueReminderEmail(to: string, customerName: string, itemName: string, dueDate: string, daysUntilDue = 0) {
  await refreshEmailStore();
  return sendBestEffort(to, dueReminderEmail(customerName, itemName, dueDate, daysUntilDue), 'due_reminder');
}

export async function sendOverdueEmail(to: string, customerName: string, itemName: string, daysOverdue: number) {
  await refreshEmailStore();
  return sendBestEffort(to, overdueEmail(customerName, itemName, daysOverdue), 'overdue');
}

// Admin "System Integrations" health probe — validates the key WITHOUT
// sending an email. GET /domains needs a full-access key; a sending-only key
// gets 401 `restricted_api_key`, which still proves the key is real, so that
// counts as connected. Also flags an unverified sending domain (Resend then
// only delivers to the account owner's own address).
export async function checkResendHealth() {
  if (!env.RESEND_API_KEY) {
    return {
      configured: false,
      reachable: false,
      detail: 'RESEND_API_KEY is not set — emails are simulated (dev mode)',
      simulated: true,
    };
  }
  const started = Date.now();
  try {
    const response = await fetch(`${RESEND_API}/domains`, {
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    });
    const latencyMs = Date.now() - started;
    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => '');
      if (/restricted_api_key/i.test(body)) {
        return { configured: true, reachable: true, latencyMs, detail: 'Connected (sending-only key)' };
      }
      return { configured: true, reachable: false, latencyMs, detail: 'Invalid API key (401)' };
    }
    if (!response.ok) {
      return { configured: true, reachable: false, latencyMs, detail: `Resend API error (${response.status}) — check the key` };
    }
    const data = (await response.json().catch(() => ({}))) as { data?: { status?: string }[] };
    const domains = Array.isArray(data?.data) ? data.data : [];
    if (domains.length > 0 && !domains.some((d) => d?.status === 'verified')) {
      return { configured: true, reachable: true, latencyMs, detail: 'Connected — sending domain not verified yet' };
    }
    return { configured: true, reachable: true, latencyMs, detail: 'Connected' };
  } catch (err) {
    return { configured: true, reachable: false, latencyMs: Date.now() - started, detail: (err as Error)?.message || 'Connection failed' };
  }
}
