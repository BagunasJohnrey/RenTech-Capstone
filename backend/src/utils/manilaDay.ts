// Store-calendar day boundaries (Asia/Manila, UTC+8, no DST).
//
// Rental dates arrive as "YYYY-MM-DD" and are stored as UTC midnight, i.e.
// 08:00 Manila ON that day. Comparing them against `now` (or a server-local
// midnight, which is UTC on Render) made a rental "overdue" at 08:00 on its
// own due date. Every "is this due today / past due" check compares against
// the start of the Manila day instead, which works for both UTC-midnight and
// Manila-midnight stored dates.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function manilaDayStart(at: Date = new Date()): Date {
  const shifted = new Date(at.getTime() + MANILA_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - MANILA_OFFSET_MS
  );
}

export function manilaNextDayStart(at: Date = new Date()): Date {
  return new Date(manilaDayStart(at).getTime() + DAY_MS);
}

export function manilaHour(at: Date = new Date()): number {
  return new Date(at.getTime() + MANILA_OFFSET_MS).getUTCHours();
}

// Customer-facing automatic reminders (SMS + email) are held overnight so a
// day boundary at Manila midnight doesn't text people at 00:01. The send
// once-guards stay false, so the held reminder goes out on the first tick
// after the window opens.
export const REMINDER_SEND_START_HOUR = 8;
export const REMINDER_SEND_END_HOUR = 21;

// `window` comes from the admin's reminder hours (settings.getReminderWindow);
// omitted = the 08:00–21:00 default.
export function isReminderQuietHours(
  at: Date = new Date(),
  window: { startHour: number; endHour: number } = { startHour: REMINDER_SEND_START_HOUR, endHour: REMINDER_SEND_END_HOUR },
): boolean {
  const h = manilaHour(at);
  return h < window.startHour || h >= window.endHour;
}

// Customer-facing date text. Without a timeZone, toLocaleDateString uses the
// server zone (UTC on Render), which prints the previous day for any date
// stored as Manila midnight.
export function formatManilaDate(d: Date): string {
  return d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });
}

// Whole Manila calendar days from the due date's day to `at`'s day (0 on the
// due day itself).
export function manilaDaysPastDue(dueDate: Date, at: Date = new Date()): number {
  return Math.round((manilaDayStart(at).getTime() - manilaDayStart(dueDate).getTime()) / DAY_MS);
}
