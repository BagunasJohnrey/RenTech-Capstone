import { getBusinessRules } from '../services/settings.service.js';

const DEFAULT_LATE_PENALTY_PER_DAY = 500;
const DEFAULT_DAMAGE_FEE = 1000;

// Fee amounts come from the BusinessRule table so the Settings page actually
// takes effect; a missing/invalid value falls back to the default constant.
// The seeded `late_penalty_per_day` key is canonical; `late_fee_per_day` is
// accepted as an alias for compatibility.
export async function calculateFees(
  rentalDate: Date,
  dueDate: Date,
  returnDate: Date,
  isDamaged: boolean
) {
  let latePerDay = DEFAULT_LATE_PENALTY_PER_DAY;
  let damage = DEFAULT_DAMAGE_FEE;
  try {
    const rules = await getBusinessRules();
    const rawLate = rules['late_fee_per_day'] ?? rules['late_penalty_per_day'];
    const parsedLate = rawLate != null ? parseFloat(rawLate) : NaN;
    if (Number.isFinite(parsedLate) && parsedLate >= 0) latePerDay = parsedLate;
    const parsedDamage = rules['damage_fee'] != null ? parseFloat(rules['damage_fee']) : NaN;
    if (Number.isFinite(parsedDamage) && parsedDamage >= 0) damage = parsedDamage;
  } catch {
    // rules store unavailable -> keep defaults
  }

  const daysLate = Math.max(
    0,
    Math.floor((returnDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const latePenalty = daysLate * latePerDay;
  const damageFee = isDamaged ? damage : 0;

  return {
    daysLate,
    latePenalty,
    damageFee,
    totalFees: latePenalty + damageFee,
  };
}
