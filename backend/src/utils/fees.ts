import { getBusinessRules } from '../services/settings.service.js';

const DEFAULT_DAMAGE_FEE = 1000;

// The damage fee comes from the BusinessRule table so the Settings page
// actually takes effect; a missing/invalid value falls back to the default.
// Staff can also override it per-return (damageFee override from the return
// modal) for case-by-case amounts.
//
// Late fees were removed (Sept 2026): returns are never charged for lateness.
// daysLate is still computed for records/staff notifications, but latePenalty
// is always 0.
export async function calculateFees(
  rentalDate: Date,
  dueDate: Date,
  returnDate: Date,
  isDamaged: boolean,
  overrides?: { damageFee?: number | null }
) {
  let damage = DEFAULT_DAMAGE_FEE;
  try {
    const rules = await getBusinessRules();
    const parsedDamage = rules['damage_fee'] != null ? parseFloat(rules['damage_fee']) : NaN;
    if (Number.isFinite(parsedDamage) && parsedDamage >= 0) damage = parsedDamage;
  } catch {
    // rules store unavailable -> keep defaults
  }

  const daysLate = Math.max(
    0,
    Math.floor((returnDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const latePenalty = 0;
  let damageFee = 0;
  if (isDamaged) {
    const o = overrides?.damageFee;
    damageFee = o != null && Number.isFinite(o) && o >= 0 ? o : damage;
  }

  return {
    daysLate,
    latePenalty,
    damageFee,
    totalFees: latePenalty + damageFee,
  };
}
