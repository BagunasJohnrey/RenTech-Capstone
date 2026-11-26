// Weekly report filter helpers — Monday–Sunday weeks on local dates.
// The backend's getPeriodFilter('weekly') uses the same convention.

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monday 00:00 of the week containing `d`.
export const weekStartOf = (d) => {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
};
// Local "YYYY-MM-DD" (never toISOString — that shifts Manila dates a day back).
export const toIsoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseIsoDay = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// "January 19 – January 25" (long) / "Jan 19 – Jan 25" (short). The year is
// appended when asked for; a week that crosses New Year shows it on both ends
// ("Dec 29, 2025 – Jan 4, 2026") except in the compact phone label (short,
// no year), which must fit the one-line header row.
export const formatWeekRange = (start, { long = false, year = false } = {}) => {
  if (!start) return '';
  const end = addDays(start, 6);
  const names = long ? LONG_MONTHS : SHORT_MONTH_NAMES;
  const md = (d) => `${names[d.getMonth()]} ${d.getDate()}`;
  if (start.getFullYear() !== end.getFullYear() && (long || year)) {
    return `${md(start)}, ${start.getFullYear()} – ${md(end)}, ${end.getFullYear()}`;
  }
  return `${md(start)} – ${md(end)}${year ? `, ${end.getFullYear()}` : ''}`;
};
