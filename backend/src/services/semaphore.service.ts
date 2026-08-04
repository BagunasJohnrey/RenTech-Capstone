import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const SEMAPHORE_API = process.env.SEMAPHORE_BASE_URL || 'https://api.semaphore.co/api/v4';

export async function sendSms(phone: string, message: string) {
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: env.SEMAPHORE_API_KEY,
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

  const data = await response.json() as { message_id?: string }[];
  return { messageId: data?.[0]?.message_id || null };
}

export function applyTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}
