import { z } from 'zod';

// Philippine mobile numbers. The UI shows them as +63 9XXXXXXXXX; storage
// keeps the 11-digit local form (09XXXXXXXXX) that SMS, tel: links and the
// existing rows already use. Inputs in either shape normalize to storage.
export const PH_MOBILE_MESSAGE = 'Enter a valid mobile number: +63 followed by 10 digits starting with 9';

export function normalizePhMobile(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/[\s\-().]/g, '');
  if (/^\+639\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return digits;
}

export const phMobile = z.preprocess(
  normalizePhMobile,
  z.string().regex(/^09\d{9}$/, PH_MOBILE_MESSAGE),
);
