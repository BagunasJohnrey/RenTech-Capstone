// Pulls an event date out of a stylist chat message ("wedding on Dec 20",
// "20 December 2026", "12/20", "2026-12-20", "tomorrow") so the stylist can
// skip items already booked for that date. Returns a UTC-midnight Date (the
// same shape rental dates are stored in) or null when no date is mentioned.
// A month/day with no year rolls forward to next year once it has passed.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

/** Today's date in Manila as UTC midnight. */
export function manilaToday(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function build(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

function withYear(m: number, d: number, year: string | undefined, today: Date): Date | null {
  if (year) return build(Number(year), m, d);
  const thisYear = build(today.getUTCFullYear(), m, d);
  if (!thisYear) return null;
  return thisYear < today ? build(today.getUTCFullYear() + 1, m, d) : thisYear;
}

/**
 * A month named with no day ("available on dec?", "sa December"). Returns the
 * month's full name so the caller can ask "Which day in December?" instead of
 * silently reusing an older date from the conversation.
 */
export function mentionedMonthOnly(text: string, now: Date = new Date()): string | null {
  if (!text || extractEventDate(text, now)) return null;
  const m = text.toLowerCase().match(new RegExp(`\\b(${MONTH_RE})\\b`));
  if (!m) return null;
  // "may" is also an English/Tagalog word; only count it when it reads like a date.
  if (m[1] === 'may' && !/\b(in|on|this|next|sa|ngayong)\s+may\b/i.test(text)) return null;
  const n = MONTHS[m[1]];
  return new Date(Date.UTC(2000, n - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' });
}

export function extractEventDate(text: string, now: Date = new Date()): Date | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const today = manilaToday(now);

  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  m = t.match(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`));
  if (m) return withYear(MONTHS[m[1]], Number(m[2]), m[3], today);

  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b(?:,?\\s*(\\d{4}))?`));
  if (m) return withYear(MONTHS[m[2]], Number(m[1]), m[3], today);

  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (m) return withYear(Number(m[1]), Number(m[2]), m[3], today);

  if (/\btomorrow\b|\bbukas\b/.test(t)) return new Date(today.getTime() + 86400000);
  if (/\btoday\b|\bngayon\b/.test(t)) return today;
  return null;
}
