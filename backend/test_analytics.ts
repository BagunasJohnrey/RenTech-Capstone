import { prisma } from './src/config/database';

async function test() {
  try {
    const items = await prisma.inventoryItem.findMany({
      include: {
        transactions: {
          where: { status: { in: ['Active', 'Returned', 'Overdue'] } },
        },
      },
    });
    console.log('Items count:', items.length);
    console.log('First item transactions:', items[0]?.transactions?.length);
  } catch (e: any) { console.error(e.message || e); }
  finally { await prisma.$disconnect(); }
}
test();
