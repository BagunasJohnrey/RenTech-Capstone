import { prisma } from '../src/config/database.js';

// Blob URLs are preview artifacts — null out these fields so ItemImage fallback takes over
// and the frontend never tries to fetch a blob from the server.
const PLACEHOLDER = null;

async function main() {
  const [brokenItems, brokenTxs] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { image: { startsWith: 'blob:' } },
      select: { id: true, name: true, image: true },
    }),
    prisma.transaction.findMany({
      where: {
        OR: [
          { releasePhoto: { startsWith: 'blob:' } },
          { returnPhoto: { startsWith: 'blob:' } },
        ],
      },
      select: { id: true, status: true, releasePhoto: true, returnPhoto: true },
    }),
  ]);

  console.log(`[cleanup] ${brokenItems.length} inventory items with blob URLs`);
  console.log(`[cleanup] ${brokenTxs.length} transactions with blob URLs`);

  if (brokenItems.length === 0 && brokenTxs.length === 0) {
    console.log('[cleanup] Nothing to fix.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const itemResult = await tx.inventoryItem.updateMany({
      where: { image: { startsWith: 'blob:' } },
      data: { image: PLACEHOLDER },
    });
    const relResult = await tx.transaction.updateMany({
      where: { releasePhoto: { startsWith: 'blob:' } },
      data: { releasePhoto: PLACEHOLDER },
    });
    const retResult = await tx.transaction.updateMany({
      where: { returnPhoto: { startsWith: 'blob:' } },
      data: { returnPhoto: PLACEHOLDER },
    });
    console.log(`[cleanup] fixed ${itemResult.count} items, ${relResult.count} release, ${retResult.count} return`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
