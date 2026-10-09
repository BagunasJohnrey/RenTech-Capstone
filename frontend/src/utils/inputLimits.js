// Shared input limits + sanitizers for names, phones, addresses, emails.
// Single source of truth so signup, OAuth details, and both rental flows
// enforce the exact same rules: phone never exceeds 11 digits, names never
// contain numbers, and every field has a character cap.

export const INPUT_LIMITS = {
  NAME_MAX: 50,
  NAME_MIN: 2,
  EMAIL_MAX: 100,
  PHONE_LENGTH: 11,
  ADDRESS_MAX: 100,
  ADDRESS_MIN: 5,
  NOTES_MAX: 300,
};

// Digits are never allowed in a person name.
const HAS_DIGIT = /\d/;
// At least one letter (unicode-aware so ñ/accents pass).
const HAS_LETTER = /[\p{L}]/u;

export function sanitizeName(value, max = INPUT_LIMITS.NAME_MAX) {
  return String(value ?? '').replace(/\d/g, '').slice(0, max);
}

export function sanitizePhone(value, max = INPUT_LIMITS.PHONE_LENGTH) {
  return String(value ?? '').replace(/\D/g, '').slice(0, max);
}

export function sanitizeAddress(value, max = INPUT_LIMITS.ADDRESS_MAX) {
  return String(value ?? '').slice(0, max);
}

export function sanitizeEmail(value, max = INPUT_LIMITS.EMAIL_MAX) {
  return String(value ?? '').slice(0, max);
}

export function sanitizeNotes(value, max = INPUT_LIMITS.NOTES_MAX) {
  return String(value ?? '').slice(0, max);
}

// Returns true when valid, otherwise an error string (same shape as the
// Login.jsx / GoogleSignupDetails.jsx validators).
export function validateName(value) {
  const v = String(value ?? '').trim();
  if (v.length < INPUT_LIMITS.NAME_MIN) return 'Enter your full name';
  if (v.length > INPUT_LIMITS.NAME_MAX) return `Name must be ${INPUT_LIMITS.NAME_MAX} characters or fewer`;
  if (HAS_DIGIT.test(v)) return 'Name must not contain numbers';
  if (!HAS_LETTER.test(v)) return 'Enter your full name';
  return true;
}

export function validatePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== INPUT_LIMITS.PHONE_LENGTH)
    return `Phone must be exactly ${INPUT_LIMITS.PHONE_LENGTH} digits`;
  return true;
}

export function validateAddress(value) {
  const v = String(value ?? '').trim();
  if (v.length < INPUT_LIMITS.ADDRESS_MIN) return 'Enter your full address';
  if (v.length > INPUT_LIMITS.ADDRESS_MAX)
    return `Address must be ${INPUT_LIMITS.ADDRESS_MAX} characters or fewer`;
  return true;
}

export function validateEmail(value) {
  const v = String(value ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address';
  if (v.length > INPUT_LIMITS.EMAIL_MAX)
    return `Email must be ${INPUT_LIMITS.EMAIL_MAX} characters or fewer`;
  return true;
}
