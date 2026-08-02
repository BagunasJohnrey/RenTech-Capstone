import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const SEMAPHORE_API = 'https://api.semaphore.co/api/v4';

export async function sendSms(phone: string, message: string) {
  if (!env.SEMAPHORE_API_KEY) {
    throw new AppError(500, 'Semaphore is not configured');
  }

  const normalizedPhone = phone.startsWith('0')
    ? `63${phone.slice(1)}`
    : phone.replace(/[^0-9]/g, '');

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
    const errorBody = await response.text();
    throw new AppError(502, `Semaphore API error: ${response.status}`, errorBody);
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
