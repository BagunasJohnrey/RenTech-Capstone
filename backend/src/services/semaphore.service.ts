import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const SEMAPHORE_API = process.env.SEMAPHORE_BASE_URL || 'https://api.semaphore.co/api/v4';

// Semaphore bills one credit per 160-char segment. Every SMS is normalized to a
// single segment here so no flow (manual, template, scheduler) can silently cost
// 2+ credits.
export const SMS_MAX_LENGTH = 160;
export const SMS_NOTICE = 'Automated message - do not reply.';

// "Maria Clara Dela Cruz" -> "Maria C." (first name + surname initial). Keeps
// greetings short without losing who the message is for. Suffixes like Jr./III
// are skipped so "Juan Dela Cruz Jr." still becomes "Juan C.".
export function smsShortName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
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
export function finalizeSms(message: string): string {
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

export async function sendSms(phone: string, message: string) {
  message = finalizeSms(message);
  // No key configured -> simulate a successful send so the booking/reminder
  // flows work in dev without real SMS credits. Fail loudly in production:
  // a silently "simulated" send would report success to the boutique while
  // customers never actually receive confirmations/reminders.
  if (!env.SEMAPHORE_API_KEY) {
    if (env.NODE_ENV === 'production') {
      throw new AppError(503, 'SMS service is not configured');
    }
    return { messageId: `sim_${Date.now()}` };
  }

  // Normalize to an international PH number. Strip formatting first, then
  // reject clearly-invalid numbers before they cost real SMS credits.
  const digits = phone.replace(/[^0-9]/g, '');
  const normalizedPhone = /^63\d{10}$/.test(digits)
    ? digits
    : digits.startsWith('0')
      ? `63${digits.slice(1)}`
      : digits;
  if (!/^63\d{10}$/.test(normalizedPhone)) {
    throw new AppError(400, 'Invalid phone number');
  }

  const response = await fetch(`${SEMAPHORE_API}/messages`, {
    method: 'POST',
    signal: AbortSignal.timeout(10000), // don't hang on a dead SMS gateway
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: env.SEMAPHORE_API_KEY,
      number: normalizedPhone,
      message,
    }),
  });

  if (!response.ok) {
    // C1: log the upstream body server-side but never forward it to the
    // client (it echoes the phone number and message text).
    const errorBody = await response.text();
    console.error('[semaphore] send failed:', response.status, errorBody);
    throw new AppError(502, `Semaphore API error: ${response.status}`);
  }

  // Read the raw body so a 200 with a non-message payload (validation
  // error object, empty body) can be logged instead of silently queuing.
  // Supports both text() (real fetch) and json() (test mocks).
  const raw = typeof response.text === 'function'
    ? await response.text()
    : JSON.stringify(await response.json());
  let data: unknown = null;
  try {
    data = raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    console.error('[semaphore] 200 with non-JSON body:', raw.slice(0, 300));
  }
  const messageId = Array.isArray(data)
    ? (data[0] as { message_id?: string } | undefined)?.message_id || null
    : (data as { message_id?: string } | null)?.message_id || null;
  if (!messageId) {
    // 200 but nothing to track: Semaphore silently drops some messages
    // (e.g. bodies starting with "TEST") or returns an unexpected shape.
    // Log server-side only (raw echoes phone/message) so we can see which.
    console.error('[semaphore] 200 but no message_id; raw:', raw.slice(0, 500));
  }
  return { messageId };
}

export function applyTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

// Admin "System Integrations" health probe — validates the API key authenticity
// against Semaphore's /account endpoint WITHOUT spending an SMS credit. In dev
// with no key the send path simulates success, so we report that explicitly.
export async function checkSemaphoreHealth() {
  if (!env.SEMAPHORE_API_KEY) {
    return {
      configured: false,
      reachable: false,
      detail: 'SEMAPHORE_API_KEY is not set — SMS are simulated (dev mode)',
      simulated: true,
    };
  }
  const started = Date.now();
  try {
    const response = await fetch(`${SEMAPHORE_API}/account?apikey=${env.SEMAPHORE_API_KEY}`, {
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { configured: true, reachable: false, latencyMs, detail: `Semaphore API error (${response.status}) — check the key` };
    }
    return { configured: true, reachable: true, latencyMs, detail: 'Connected' };
  } catch (err) {
    return { configured: true, reachable: false, latencyMs: Date.now() - started, detail: (err as Error)?.message || 'Connection failed' };
  }
}
