/**
 * Season-aware suggestion chips for the AI stylist.
 *
 * Philippine demand follows the event calendar (weddings Feb-May + Dec,
 * graduations May-Jun, Halloween in Oct, Christmas parties Nov-Dec), so the
 * first chip follows the season while the rest are stable FAQ shortcuts
 * (booking / sizing / pricing / location — all answered instantly by the
 * local FAQ). Pure functions taking `now` so they are trivially testable.
 */

export const BOOKING_CHIP = 'How do I book?';
export const SIZES_CHIP = 'What sizes do you have?';
export const PRICE_CHIP = 'How much is rental?';
export const PLACE_CHIP = 'Store location & hours';

// The seasonal occasion chip for the given date. Weddings are the
// year-round anchor (always first unless a holiday-specific season
// overrides), so September and the other quiet months still lead with it.
export function seasonalEventChip(now = new Date()) {
  const m = now.getMonth();
  if (m === 9) return 'Costume for Halloween';
  if (m === 10 || m === 11) return 'Outfit for a Christmas party';
  if (m === 0) return 'Outfit for a New Year party';
  if (m === 4 || m === 5) return 'Suit for a graduation';
  return 'What fits a wedding guest?';
}

// Peak event months: customers book first, ask price later. Off-peak the
// price question leads.
export function isPeakMonth(now = new Date()) {
  const m = now.getMonth();
  return m === 11 || m === 0 || (m >= 1 && m <= 5) || m === 9 || m === 10;
}

export function faqChips(now = new Date()) {
  return isPeakMonth(now)
    ? [BOOKING_CHIP, SIZES_CHIP, PRICE_CHIP, PLACE_CHIP]
    : [PRICE_CHIP, SIZES_CHIP, BOOKING_CHIP, PLACE_CHIP];
}

export function getWelcomeSuggestions(now = new Date()) {
  const chips = [];
  const seasonal = seasonalEventChip(now);
  if (seasonal) chips.push(seasonal);
  chips.push(
    'What fits a wedding guest?',
    'Suit for a graduation',
    'Gown for a debut party',
    ...faqChips(now),
  );
  return [...new Set(chips)].slice(0, 5);
}

// Follow-ups after a turn: drill into the current event first, then the
// seasonal occasion (unless it IS the current event), then FAQ shortcuts.
export function getNextSuggestions({ userEvent, source, now = new Date() }) {
  if (source === 'error') return faqChips(now);
  const chips = [];
  if (userEvent) chips.push(`Show more ${userEvent} options`);
  const seasonal = seasonalEventChip(now);
  if (seasonal && (!userEvent || !seasonal.toLowerCase().includes(userEvent))) {
    chips.push(seasonal);
  }
  chips.push(...faqChips(now));
  return [...new Set(chips)].slice(0, 4);
}
