// Brevo (formerly Sendinblue) transactional email delivery.
//
// Mirrors the semaphore/paymongo service shape: plain fetch against the Brevo
// REST API (no SDK dependency), 10s timeout, simulated success in dev/test
// when no key is configured, loud failure in production.
//
// Every send is best-effort from the caller's perspective for ORDER emails
// (booking/pickup/return/...) — those helpers never throw for a failed send,
// they log and return { delivered: false }. AUTH emails (verification, reset)
// DO throw on failure so the controller can surface an honest error (a user
// who never receives their link is stuck without one).

import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { isEmailEnabled } from './settings.service.js';
import {
  verificationEmail,
  passwordResetEmail,
  bookingConfirmationEmail,
  pickupEmail,
  returnEmail,
  cancellationEmail,
  dueReminderEmail,
  overdueEmail,
  staffWelcomeEmail,
  type BookingDetails,
} from '../templates/emailTemplates.js';

const BREVO_API = process.env.BREVO_API_URL || 'https://api.brevo.com/v3';

export interface SendResult {
  messageId: string | null;
  simulated: boolean;
  delivered: boolean;
}

function sender() {
  return {
    email: env.BREVO_SENDER_EMAIL || 'noreply@rentech.local',
    name: env.BREVO_SENDER_NAME || 'RenTech',
  };
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

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const to = params.to.trim();
  if (!isSendableEmail(to)) {
    throw new AppError(400, 'Invalid recipient email');
  }

  // No key configured -> simulate success in dev/test so every flow works
  // without real email credits. Fail loudly in production: a silently
  // "simulated" verification email would leave the user locked out forever.
  if (!env.BREVO_API_KEY) {
    if (env.NODE_ENV === 'production') {
      throw new AppError(503, 'Email service is not configured');
    }
    return { messageId: `sim_${Date.now()}`, simulated: true, delivered: false };
  }

  let response: Response;
  try {
    response = await fetch(`${BREVO_API}/smtp/email`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: sender(),
        to: [{ email: to }],
        subject: params.subject,
        htmlContent: params.html,
        textContent: params.text,
      }),
    });
  } catch (err) {
    console.error('[brevo] send failed (network):', (err as Error)?.message);
    throw new AppError(502, 'Email service is unavailable. Please try again later.');
  }

  if (!response.ok) {
    // Log the upstream body server-side but never forward it (may echo PII).
    const errorBody = await response.text().catch(() => '');
    console.error('[brevo] send failed:', response.status, errorBody.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new AppError(500, 'Email service rejected the request. Please contact the boutique.');
    }
    if (response.status === 429) {
      throw new AppError(429, 'Email service is busy. Please wait a few minutes and try again.');
    }
    throw new AppError(502, 'Could not send the email. Please try again later.');
  }

  const data = (await response.json().catch(() => ({}))) as { messageId?: string };
  return { messageId: data?.messageId ?? null, simulated: false, delivered: true };
}

/** Order/lifecycle emails: best-effort — log + swallow so email never blocks a booking. */
async function sendBestEffort(to: string, built: { subject: string; html: string; text: string }): Promise<SendResult | null> {
  if (!isSendableEmail(to)) return null;
  // Global kill-switch (admin Integrations tab) — auth emails bypass this
  // (they call sendEmail directly) so verification/reset always work.
  try {
    if (!(await isEmailEnabled())) return null;
  } catch {
    // fail-open: if the flag can't be read, attempt the send as before
  }
  try {
    return await sendEmail({ to, ...built });
  } catch (err) {
    console.error('[brevo] lifecycle email skipped:', (err as Error)?.message);
    return null;
  }
}

// ---- Auth emails (throw on failure — caller surfaces the error) ----

export function sendVerificationEmail(to: string, name: string, verifyUrl: string) {
  return sendEmail({ to, ...verificationEmail(name, verifyUrl) });
}

export function sendPasswordResetEmail(to: string, name: string, resetUrl: string) {
  return sendEmail({ to, ...passwordResetEmail(name, resetUrl) });
}

export function sendStaffWelcomeEmail(to: string, name: string, oneTimePassword: string) {
  return sendBestEffort(to, staffWelcomeEmail(name, oneTimePassword));
}

// ---- Order emails (best-effort — never block the rental flow) ----

export function sendBookingConfirmationEmail(to: string, details: BookingDetails) {
  return sendBestEffort(to, bookingConfirmationEmail(details));
}

export function sendPickupEmail(to: string, customerName: string, itemName: string, dueDate: string) {
  return sendBestEffort(to, pickupEmail(customerName, itemName, dueDate));
}

export function sendReturnEmail(
  to: string,
  customerName: string,
  itemName: string,
  opts?: { latePenalty?: number; damageFee?: number; damageReason?: string | null },
) {
  return sendBestEffort(to, returnEmail(customerName, itemName, opts));
}

export function sendCancellationEmail(to: string, customerName: string, itemName: string) {
  return sendBestEffort(to, cancellationEmail(customerName, itemName));
}

export function sendDueReminderEmail(to: string, customerName: string, itemName: string, dueDate: string) {
  return sendBestEffort(to, dueReminderEmail(customerName, itemName, dueDate));
}

export function sendOverdueEmail(to: string, customerName: string, itemName: string, daysOverdue: number) {
  return sendBestEffort(to, overdueEmail(customerName, itemName, daysOverdue));
}

// Admin "System Integrations" health probe — validates the key against
// Brevo's /account endpoint WITHOUT sending an email. In dev with no key the
// send path simulates, so report that explicitly.
export async function checkBrevoHealth() {
  if (!env.BREVO_API_KEY) {
    return {
      configured: false,
      reachable: false,
      detail: 'BREVO_API_KEY is not set — emails are simulated (dev mode)',
      simulated: true,
    };
  }
  const started = Date.now();
  try {
    const response = await fetch(`${BREVO_API}/account`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'api-key': env.BREVO_API_KEY },
    });
    const latencyMs = Date.now() - started;
    if (response.status === 401 || response.status === 403) {
      return { configured: true, reachable: false, latencyMs, detail: 'Invalid API key (401)' };
    }
    if (!response.ok) {
      return { configured: true, reachable: false, latencyMs, detail: `Brevo API error (${response.status}) — check the key` };
    }
    return { configured: true, reachable: true, latencyMs, detail: 'Connected' };
  } catch (err) {
    return { configured: true, reachable: false, latencyMs: Date.now() - started, detail: (err as Error)?.message || 'Connection failed' };
  }
}
