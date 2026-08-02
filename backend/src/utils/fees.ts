const LATE_PENALTY_PER_DAY = 500;
const DAMAGE_FEE = 1000;

export function calculateFees(
  rentalDate: Date,
  dueDate: Date,
  returnDate: Date,
  isDamaged: boolean
) {
  const daysLate = Math.max(
    0,
    Math.floor((returnDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const latePenalty = daysLate * LATE_PENALTY_PER_DAY;
  const damageFee = isDamaged ? DAMAGE_FEE : 0;

  return {
    daysLate,
    latePenalty,
    damageFee,
    totalFees: latePenalty + damageFee,
  };
}
