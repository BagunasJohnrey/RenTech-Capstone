/**
 * Backfill missing Payment rows for old bookings + normalize balances.
 *
 * Background: before the downpaymentCash fix, createRental stored the booking
 * downpayment as a bare number (totalPaid stayed 0) and wrote NO Payment row —
 * so every peso of booking-time counter cash is invisible to revenue, and old
 * balances were computed as fee + penalties − downpayment − totalPaid while
 * new code uses fee + penalties − totalPaid. This script reunites them:
 *
 *   For each non-cancelled transaction:
 *   1. gap = totalPaid − SUM(payment rows). If gap > 0, the difference is
 *      unrowed cash (recordPayment always writes a row) → plan a completed
 *      row for the gap. totalPaid itself is trusted and unchanged.
 *   2. Else if totalPaid is 0, no rows exist, and downpayment > 0 on a NON-
 *      simulated booking → the cash was taken at the counter but never
 *      rowed: plan a completed row for the downpayment and seed totalPaid.
 *      Simulated bookings (gateway ref starting with `sim_`, incl. the
 *      legacy payment_intent_id column) moved NO money, so they are NEVER
 *      given rows — even when they show a downpayment number.
 *   3. Recompute balance = max(0, fee + late + damage − totalPaid) under the
 *      single current formula and update it when it differs.
 *   Cancelled transactions are skipped entirely (terminal; a row there would
 *   inflate revenue for dead bookings).
 *
 * Idempotent: re-running finds the rows it wrote (gap 0, totalPaid seeded)
 * and plans nothing.
 *
 * Usage (backend STOPPED first — same engine-DLL rule as the other scripts):
 *   npx tsx scripts/backfill-payments.ts            # dry run: prints the plan
 *   npx tsx scripts/backfill-payments.ts --apply    # writes rows + balances
 */

import { prisma } from '../src/config/database.js';
import { createAuditLog } from '../src/utils/audit.js';

const APPLY = process.argv.includes('--apply');
const EPS = 0.005;

type PlanRow =
  | { kind: 'create-payment'; txId: string; txNumber: number; amount: number; note: string }
  | { kind: 'update-tx'; txId: string; txNumber: number; totalPaid: number; balance: number; oldBalance: number; note: string };

async function legacySimRefs(): Promise<Set<string>> {
  // The pre-rename `payment_intent_id` column may still exist alongside
  // `gateway_payment_id`; Prisma only knows the latter, so read it raw.
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; payment_intent_id: string | null }>>`
      SELECT id, payment_intent_id FROM transactions WHERE payment_intent_id IS NOT NULL
    `;
    return new Set(rows.filter((r) => r.payment_intent_id?.startsWith('sim_')).map((r) => r.id));
  } catch {
    return new Set(); // column gone — nothing legacy to detect
  }
}

async function main() {
  console.log(APPLY ? 'APPLY mode: writing changes.' : 'DRY RUN — no writes. Pass --apply to write.');
  const legacySims = await legacySimRefs();

  const txs = await prisma.transaction.findMany({
    select: {
      id: true, txNumber: true, status: true,
      rentalFee: true, downpayment: true, latePenalty: true, damageFee: true,
      totalPaid: true, balance: true, gatewayPaymentId: true,
      payments: { select: { amount: true } },
    },
    orderBy: { txNumber: 'asc' },
  });
  console.log(`Scanned ${txs.length} transaction(s).`);

  const plans: PlanRow[] = [];
  let skippedCancelled = 0;
  let skippedSim = 0;

  for (const tx of txs) {
    if (tx.status === 'Cancelled') { skippedCancelled++; continue; }
    const rowSum = tx.payments.reduce((s, p) => s + p.amount, 0);
    const gap = tx.totalPaid - rowSum;
    const sim = (tx.gatewayPaymentId?.startsWith('sim_') ?? false) || legacySims.has(tx.id);
    const fee = tx.rentalFee + tx.latePenalty + tx.damageFee;

    if (sim) {
      skippedSim++;
      const balance = Math.max(0, fee - tx.totalPaid);
      if (Math.abs(balance - tx.balance) > EPS) {
        plans.push({ kind: 'update-tx', txId: tx.id, txNumber: tx.txNumber, totalPaid: tx.totalPaid, balance, oldBalance: tx.balance, note: 'simulated: no money moved, balance restated to full amount owed' });
      }
      continue;
    }

    if (gap > EPS) {
      // Unrowed cash already inside totalPaid — row it so revenue counts it.
      const balance = Math.max(0, fee - tx.totalPaid);
      plans.push({ kind: 'create-payment', txId: tx.id, txNumber: tx.txNumber, amount: Math.round(gap * 100) / 100, note: `unrowed cash inside totalPaid (${tx.totalPaid.toLocaleString()})` });
      if (Math.abs(balance - tx.balance) > EPS) {
        plans.push({ kind: 'update-tx', txId: tx.id, txNumber: tx.txNumber, totalPaid: tx.totalPaid, balance, oldBalance: tx.balance, note: 'normalize to fee + penalties − totalPaid' });
      }
    } else if (tx.totalPaid <= EPS && rowSum <= EPS && tx.downpayment > EPS) {
      // Cash taken at booking, never rowed: seed it.
      const amount = Math.round(tx.downpayment * 100) / 100;
      plans.push({ kind: 'create-payment', txId: tx.id, txNumber: tx.txNumber, amount, note: 'booking-time counter cash (downpayment had no row)' });
      const balance = Math.max(0, fee - amount);
      plans.push({ kind: 'update-tx', txId: tx.id, txNumber: tx.txNumber, totalPaid: amount, balance, oldBalance: tx.balance, note: 'seed totalPaid + normalize balance' });
    } else {
      const balance = Math.max(0, fee - tx.totalPaid);
      if (Math.abs(balance - tx.balance) > EPS) {
        plans.push({ kind: 'update-tx', txId: tx.id, txNumber: tx.txNumber, totalPaid: tx.totalPaid, balance, oldBalance: tx.balance, note: 'normalize to fee + penalties − totalPaid' });
      }
    }
  }

  const creates = plans.filter((p) => p.kind === 'create-payment');
  const updates = plans.filter((p) => p.kind === 'update-tx');
  const revenueImpact = creates.reduce((s, p) => s + (p.kind === 'create-payment' ? p.amount : 0), 0);

  for (const p of plans) {
    if (p.kind === 'create-payment') {
      console.log(`  + TX #${p.txNumber}: Payment row ₱${p.amount.toLocaleString()} (completed/cash) — ${p.note}`);
    } else {
      console.log(`  ~ TX #${p.txNumber}: totalPaid → ₱${p.totalPaid.toLocaleString()}, balance ₱${p.oldBalance.toLocaleString()} → ₱${p.balance.toLocaleString()} — ${p.note}`);
    }
  }
  console.log(`\nPlan: ${creates.length} payment row(s) (₱${revenueImpact.toLocaleString()} newly counted revenue), ${updates.length} balance/total update(s). Skipped: ${skippedCancelled} cancelled, ${skippedSim} simulated (no money moved).`);

  if (!APPLY) {
    console.log('Dry run complete — nothing written.');
    return;
  }

  let done = 0;
  for (const tx of txs) {
    if (tx.status === 'Cancelled') continue;
    const mine = plans.filter((p) => p.txId === tx.id);
    if (mine.length === 0) continue;
    const create = mine.find((p) => p.kind === 'create-payment');
    const update = mine.find((p) => p.kind === 'update-tx');
    try {
      await prisma.$transaction(async (db) => {
        if (create && create.kind === 'create-payment') {
          await db.payment.create({
            data: {
              transactionId: tx.id,
              amount: create.amount,
              method: 'cash',
              type: (update && update.kind === 'update-tx' ? update.balance : tx.balance) <= 0 ? 'full' : 'partial',
              status: 'completed',
            },
          });
        }
        if (update && update.kind === 'update-tx') {
          await db.transaction.update({
            where: { id: tx.id },
            data: { totalPaid: update.totalPaid, balance: update.balance },
          });
        }
      });
      await createAuditLog({
        action: 'backfill',
        entity: 'transaction',
        entityId: tx.id,
        newValue: { backfillPayments: true },
      }).catch(() => {});
      done++;
    } catch (err) {
      console.error(`  ✗ TX #${tx.txNumber}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nApplied to ${done} transaction(s). Re-run to verify (should plan nothing).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
