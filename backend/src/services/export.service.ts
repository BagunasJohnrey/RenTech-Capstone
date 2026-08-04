import { prisma } from '../config/database.js';

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  // L1: CSV formula injection — a customer name, note or item name that begins
  // with = + - @ (or a tab/CR inside) would execute as a formula when the file
  // is opened in Excel/Sheets. Prefix a single quote to neutralize it.
  const guarded = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (guarded.includes(',') || guarded.includes('"') || guarded.includes('\n')) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCsv(row[h])).join(','));
  }
  return lines.join('\n');
}

export async function exportTransactions(format: 'csv' = 'csv') {
  const transactions = await prisma.transaction.findMany({
    include: {
      customer: { select: { name: true, email: true } },
      item: { select: { name: true, category: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows = transactions.map(tx => ({
    ID: tx.txNumber,
    Customer: tx.customer?.name || '',
    Email: tx.customer?.email || '',
    Item: tx.item?.name || '',
    Category: tx.item?.category || '',
    'Rental Date': tx.rentalDate.toISOString().split('T')[0],
    'Due Date': tx.dueDate.toISOString().split('T')[0],
    'Return Date': tx.returnDate ? tx.returnDate.toISOString().split('T')[0] : '',
    Status: tx.status,
    'Rental Fee': tx.rentalFee,
    Downpayment: tx.downpayment,
    'Late Penalty': tx.latePenalty,
    'Damage Fee': tx.damageFee,
    Balance: tx.balance,
    Notes: tx.notes || '',
  }));

  return toCsv(rows);
}

export async function exportRevenue(format: 'csv' = 'csv') {
  const transactions = await prisma.transaction.findMany({
    where: { status: { in: ['Returned', 'Active', 'Overdue'] } },
    include: {
      customer: { select: { name: true } },
      item: { select: { name: true, category: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows = transactions.map(tx => ({
    ID: tx.txNumber,
    Customer: tx.customer?.name || '',
    Item: tx.item?.name || '',
    Category: tx.item?.category || '',
    'Rental Fee': tx.rentalFee,
    Downpayment: tx.downpayment,
    'Late Penalty': tx.latePenalty,
    'Damage Fee': tx.damageFee,
    'Total Paid': tx.totalPaid,
    Balance: tx.balance,
    Status: tx.status,
    'Rental Date': tx.rentalDate.toISOString().split('T')[0],
    'Due Date': tx.dueDate.toISOString().split('T')[0],
    'Return Date': tx.returnDate ? tx.returnDate.toISOString().split('T')[0] : '',
  }));

  return toCsv(rows);
}

export async function exportInventory(format: 'csv' = 'csv') {
  const items = await prisma.inventoryItem.findMany({
    include: {
      transactions: {
        where: { status: { in: ['Active', 'Returned', 'Overdue'] } },
        select: { id: true, rentalFee: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  const rows = items.map(item => ({
    ID: item.id,
    Name: item.name,
    Category: item.category,
    Price: item.price,
    Status: item.status,
    Size: item.size || '',
    Description: item.description || '',
    'Total Rentals': item.transactions.length,
    'Total Revenue': item.transactions.reduce((s, t) => s + t.rentalFee, 0),
  }));

  return toCsv(rows);
}
