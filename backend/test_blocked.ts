import { prisma } from './src/config/database';

async function test() {
  try {
    const result = await prisma.transaction.findMany({
      where: { itemId: 1018, status: { in: ['Active', 'Overdue', 'Reserved'] } },
      include: { customer: { select: { name: true } } },
      orderBy: { rentalDate: 'asc' },
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (e: any) { console.error(e.message || e); }
  finally { await prisma.$disconnect(); }
}
test();
