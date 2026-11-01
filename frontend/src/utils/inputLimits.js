// Shared input limits + sanitizers for names, phones, addresses, emails.
// Single source of truth so signup, OAuth details, and both rental flows
// enforce the exact same rules: phones are PH mobiles (+63 9…), names never
// contain numbers, and every field has a character cap.

export const INPUT_LIMITS = {
  NAME_MAX: 50,
  NAME_MIN: 2,
  EMAIL_MAX: 100,
  // Stored phone form: 09XXXXXXXXX (11 digits). Shown as +63 + 10 digits.
  PHONE_LENGTH: 11,
  PHONE_PREFIX: '+63',
  PHONE_LOCAL_DIGITS: 10,
  ADDRESS_MAX: 100,
  ADDRESS_MIN: 5,
  NOTES_MAX: 300,
  // Catalog item names feed SMS receipts/reminders, which are capped at one
  // 160-char segment. 60 keeps names scannable and leaves message room.
  ITEM_NAME_MAX: 60,
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

// The 10 digits after +63 for any shape: the stored 09…, a partly typed
// stored value (0 + digits so far), or a pasted 0917… / 63917… / +63917….
// A +63 number never continues with 0, so leading zeros are dropped.
export function phoneLocalDigits(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('63')) d = d.slice(2);
  return d.replace(/^0+/, '').slice(0, INPUT_LIMITS.PHONE_LOCAL_DIGITS);
}

// Text typed after the +63 prefix -> stored 0XXXXXXXXXX ('' when empty).
export function phoneFromLocalInput(value) {
  const local = phoneLocalDigits(value);
  return local ? `0${local}` : '';
}

// +63XXXXXXXXXX for display; falls back to the raw value when not a PH mobile.
export function formatPhoneDisplay(value) {
  const v = String(value ?? '');
  return /^09\d{9}$/.test(v) ? `+63${v.slice(1)}` : v;
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

export const PHONE_ERROR = 'Enter a valid mobile number: +63 followed by 10 digits starting with 9';

// Accepts the stored form (09XXXXXXXXX) or +639XXXXXXXXX.
export function validatePhone(value) {
  const v = String(value ?? '').replace(/[\s\-().]/g, '');
  if (/^09\d{9}$/.test(v) || /^\+639\d{9}$/.test(v)) return true;
  return PHONE_ERROR;
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
