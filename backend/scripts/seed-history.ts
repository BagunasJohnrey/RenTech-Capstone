/**
 * Seed realistic rental history across every month for the last 2 years so
 * dashboards, revenue charts, forecasts, and AI reports have real-looking
 * data to work with.
 *
 * SAFETY (read before --apply):
 *  - Seeded customers use `seed_<n>@rentech.invalid` emails and NULL phones,
 *    so the SMS/email scheduler can never contact them (same convention as
 *    walk-ins). No notifications or emails are created by this script.
 *  - Live item statuses are NEVER flipped — only transaction + payment rows
 *    are inserted.
 *  - Refuses to run twice: aborts if any seed_@rentech.invalid profile exists
 *    (delete them manually if you truly want a re-seed).
 *  - Money math matches app conventions: balance = fee + damage − totalPaid,
 *    payment rows are completed (counter) or succeeded (gateway with unique
 *    seed_ refs), mostly fully paid with a realistic minority partial/unpaid.
 *
 * Usage (backend STOPPED first — same engine-DLL rule as the other scripts):
 *   npx tsx scripts/seed-history.ts              # dry run: prints the plan
 *   npx tsx scripts/seed-history.ts --apply       # writes rows
 *   npx tsx scripts/seed-history.ts --apply --months 12   # last 12 months only
 */

import { randomUUID } from 'crypto';
import { prisma } from '../src/config/database.js';

const APPLY = process.argv.includes('--apply');
const MONTHS_ARG = process.argv.find((a) => a.startsWith('--months'));
const MONTHS = Math.max(1, Math.min(36, parseInt(MONTHS_ARG?.split('=')[1] ?? '24', 10) || 24));

const NAMES = [
  'Maria Santos', 'Jose Rizal', 'Ana Reyes', 'Mark Villanueva', 'Jenny Cruz', 'Paolo Gutierrez',
  'Katrina Uy', 'Miguel Torres', 'Sofia Mendoza', 'Rafael Lim', 'Isabelle Ramos', 'Daniel Aquino',
  'Grace Navarro', 'Christian Flores', 'Bianca Salazar', 'Enrico Dela Cruz', 'Liza Fernandez',
  'Marco Pascual', 'Aileen Castillo', 'Renzo Morales', 'Divina Ramos', 'Jomari Santos', 'Kaye Abad',
  'Alvin Patrimonio', 'Dessa Angeles', 'Ramon Bautista', 'Cherry Pie Picache', 'Vhong Navarro',
  'Maja Salvador', 'Piolo Pascual', 'Sarah Geronimo', 'John Lloyd Cruz', 'Bea Alonzo', 'Dingdong Dantes',
  'Marian Rivera', 'Alden Richards', 'Kathryn Bernardo', 'Daniel Padilla', 'Liza Soberano', 'Nadine Lustre',
  'James Reid', 'Yassi Pressman', 'Elmo Magalona',   'Julie Anne San Jose', 'Maine Mendoza',
  'Coco Martin', 'Angel Locsin',
];
const ADDRESSES = [
  'Poblacion, Balayan, Batangas', 'Brgy. Caloocan, Balayan, Batangas', 'Brgy. Malinis, Balayan, Batangas',
  'Brgy. San Juan, Balayan, Batangas', 'Brgy. Lanatan, Balayan, Batangas', 'Brgy. Gumamela, Balayan, Batangas',
  'Calatagan, Batangas', 'Lian, Batangas', 'Tuy, Batangas', 'Nasugbu, Batangas',
];
const SIZES = ['XS', 'S', 'S', 'M', 'M', 'M', 'L', 'L', 'XL'];
const DAMAGE_REASONS = ['Torn hem', 'Stained bodice', 'Missing button', 'Loose zipper', 'Small rip at seam'];
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(arr: T[]): T => arr[rnd(arr.length)];
const peso = (n: number) => `₱${Math.round(n).toLocaleString()}`;

type SeedPayment = { amount: number; method: string; status: string; gateway: string | null; gatewayRef: string | null; createdAt: Date; type: string };
type SeedTx = {
  customerIdx: number; itemId: number; rentalDate: Date; dueDate: Date; returnDate: Date | null;
  status: string; rentalFee: number; downpayment: number; damageFee: number; damageReason: string | null;
  size: string; createdAt: Date; staffId: string | null; payments: SeedPayment[];
  totalPaid: number; balance: number;
};

async function main() {
  console.log(APPLY ? 'APPLY mode: writing seed history.' : 'DRY RUN — no writes. Pass --apply to write.');

  const existing = await prisma.profile.count({ where: { email: { startsWith: 'seed_', endsWith: '@rentech.invalid' } } });
  if (existing > 0) {
    console.error(`Refusing: ${existing} seed customer(s) already exist. Delete them first for a re-seed.`);
    process.exit(1);
  }

  const items = await prisma.inventoryItem.findMany({
    where: { status: { not: 'Deleted' } },
    select: { id: true, price: true },
  });
  if (items.length === 0) { console.error('No bookable inventory — nothing to seed against.'); process.exit(1); }
  const staff = await prisma.profile.findMany({ where: { role: { in: ['Staff', 'Admin'] } }, select: { id: true } });
  const staffId = () => (staff.length ? pick(staff).id : null);

  const now = new Date();
  const txs: SeedTx[] = [];
  const perMonth: Array<{ label: string; count: number; revenue: number }> = [];
  let custCount = 0;

  for (let m = MONTHS - 1; m >= 0; m--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const label = monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const isCurrent = m === 0;
    const lastDay = isCurrent ? now.getDate() : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const count = 6 + rnd(9); // 6–14 rentals per month
    let monthRevenue = 0;

    for (let i = 0; i < count; i++) {
      const item = pick(items);
      const fee = Math.max(500, Math.round(item.price));
      const day = 1 + rnd(lastDay);
      const rentalDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(day, lastDay));
      const dueDate = new Date(rentalDate); dueDate.setDate(dueDate.getDate() + 3 + rnd(4));
      const createdAt = new Date(rentalDate); createdAt.setDate(createdAt.getDate() - rnd(8));
      const future = rentalDate.getTime() > new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const staff = staffId();

      let status: string; let returnDate: Date | null = null;
      if (future) { status = 'Reserved'; }
      else if (dueDate.getTime() >= now.getTime()) { status = Math.random() < 0.7 ? 'Reserved' : 'Active'; }
      else {
        const r = Math.random();
        status = r < 0.9 ? 'Returned' : r < 0.95 ? 'Cancelled' : r < 0.98 ? 'Overdue' : 'Active';
        if (status === 'Returned') {
          returnDate = new Date(dueDate);
          returnDate.setDate(returnDate.getDate() + (Math.random() < 0.8 ? rnd(2) : 2 + rnd(4)));
          if (returnDate.getTime() > now.getTime()) returnDate = new Date(now);
        }
      }

      const downpayment = status === 'Cancelled' && Math.random() < 0.5 ? 0 : Math.min(fee, 200 + rnd(9) * 100);
      const damaged = status === 'Returned' && Math.random() < 0.07;
      const damageFee = damaged ? 500 + rnd(3) * 500 : 0;
      const payments: SeedPayment[] = [];

      if (status !== 'Cancelled' && downpayment > 0) {
        // Downpayment at booking: counter cash or a static-QR transfer.
        const online = Math.random() < 0.3;
        const gw1 = online ? 'manual' : null;
        payments.push({
          amount: downpayment, method: !online ? 'cash' : 'instapay',
          status: online ? 'succeeded' : 'completed',
          gateway: gw1, gatewayRef: online ? `seed_${randomUUID().replace(/-/g, '')}` : null,
          createdAt, type: 'downpayment',
        });
        // Remainder: mostly fully paid at pickup, sometimes partial.
        const rest = fee + damageFee - downpayment;
        if (rest > 0 && (future || Math.random() < 0.92)) {
          if (!future) {
            const paidAt = new Date(rentalDate); paidAt.setDate(paidAt.getDate() + rnd(2));
            const settled = Math.random() < 0.94;
            const amt = settled ? rest : Math.round(rest / 2);
            const on2 = Math.random() < 0.25;
            const gw2 = on2 ? 'manual' : null;
            payments.push({
              amount: amt, method: !on2 ? 'cash' : 'instapay',
              status: on2 ? 'succeeded' : 'completed',
              gateway: gw2, gatewayRef: on2 ? `seed_${randomUUID().replace(/-/g, '')}` : null,
              createdAt: paidAt > now ? new Date(now) : paidAt,
              type: amt >= rest ? 'full' : 'partial',
            });
          }
        }
      }

      const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
      txs.push({
        customerIdx: custCount++, itemId: item.id, rentalDate, dueDate, returnDate, status,
        rentalFee: fee, downpayment, damageFee, damageReason: damaged ? pick(DAMAGE_REASONS) : null,
        size: pick(SIZES), createdAt: createdAt > now ? new Date(now) : createdAt, staffId: staff,
        payments, totalPaid, balance: Math.max(0, fee + damageFee - totalPaid),
      });
      monthRevenue += totalPaid;
    }
    perMonth.push({ label, count, revenue: monthRevenue });
  }

  const totalRevenue = perMonth.reduce((s, m) => s + m.revenue, 0);
  console.log(`\nPlan: ${txs.length} booking(s) across ${perMonth.length} month(s), ${custCount} seed customer(s).`);
  console.log('Month            Bookings   Collected');
  for (const m of perMonth) {
    console.log(`  ${m.label.padEnd(14)} ${String(m.count).padStart(4)}   ${peso(m.revenue).padStart(10)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(14)} ${String(txs.length).padStart(4)}   ${peso(totalRevenue).padStart(10)}`);
  const sample = txs[0];
  if (sample) {
    console.log(`\nSample: item #${sample.itemId}, fee ${peso(sample.rentalFee)}, dp ${peso(sample.downpayment)}, paid ${peso(sample.totalPaid)}, balance ${peso(sample.balance)}, ${sample.status}, ${sample.payments.length} payment row(s).`);
  }
  if (!APPLY) { console.log('\nDry run complete — nothing written.'); return; }

  // Write: customers first (one per booking keeps history varied), then bookings.
  const custIds: string[] = [];
  for (let n = 0; n < custCount; n++) {
    const c = await prisma.profile.create({
      data: {
        userId: `seed_user_${randomUUID().replace(/-/g, '')}`,
        email: `seed_${randomUUID().replace(/-/g, '').slice(0, 8)}@rentech.invalid`,
        name: pick(NAMES), phone: null, address: pick(ADDRESSES), role: 'Customer',
      },
      select: { id: true },
    });
    custIds.push(c.id);
  }
  let n = 0;
  for (const t of txs) {
    await prisma.transaction.create({
      data: {
        customerId: custIds[t.customerIdx], processedById: t.staffId, assistedById: t.staffId,
        releasedById: t.status === 'Returned' || t.status === 'Active' || t.status === 'Overdue' ? t.staffId : null,
        itemId: t.itemId, rentalDate: t.rentalDate, dueDate: t.dueDate, returnDate: t.returnDate,
        status: t.status as 'Active' | 'Overdue' | 'Reserved' | 'Returned' | 'Cancelled',
        rentalFee: t.rentalFee, downpayment: t.downpayment, damageFee: t.damageFee,
        damageReason: t.damageReason, totalPaid: t.totalPaid, balance: t.balance,
        size: t.size, notes: null, createdAt: t.createdAt,
        gateway: t.payments.some((p) => p.gateway) ? t.payments.find((p) => p.gateway)!.gateway : null,
        gatewayPaymentId: t.payments.some((p) => p.gatewayRef) ? t.payments.find((p) => p.gatewayRef)!.gatewayRef : null,
        payments: {
          create: t.payments.map((p) => ({
            amount: p.amount, method: p.method, type: p.type,
            gateway: p.gateway ?? 'manual', gatewayRef: p.gatewayRef, status: p.status, createdAt: p.createdAt,
          })),
        },
      },
    });
    if (++n % 50 === 0) console.log(`  wrote ${n}/${txs.length}...`);
  }
  console.log(`\nSeeded ${txs.length} booking(s) + ${txs.reduce((s, t) => s + t.payments.length, 0)} payment row(s). Re-run refuses while seed customers exist.`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
