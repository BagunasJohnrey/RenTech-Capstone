import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { prisma } from '../src/config/database.js';
import { exportTransactions, exportWorkbook } from '../src/services/export.service.js';

const tx = {
  txNumber: 'TX-0001',
  customer: { name: 'Maria Clara', email: 'maria@example.com' },
  item: { name: 'Ivory Gown', category: 'Gown' },
  assistedBy: null,
  releasedBy: null,
  rentalDate: new Date('2026-10-01T00:00:00Z'),
  dueDate: new Date('2026-10-04T00:00:00Z'),
  returnDate: null,
  status: 'Active',
  rentalFee: 1500,
  downpayment: 750.5,
  latePenalty: 0,
  damageFee: 0,
  totalPaid: 750.5,
  balance: 749.5,
  notes: '',
};

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

describe('Excel export letterhead', () => {
  it('prints business profile, exporter and logo above the table', async () => {
    vi.mocked(prisma.businessRule.findMany).mockResolvedValueOnce([
      { key: 'business_name', value: "Mylene's Boutique" },
      { key: 'business_address', value: 'Plaza Mabini, Balayan, Batangas' },
      { key: 'business_contact', value: '0917 123 4567' },
    ] as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([tx] as never);

    const wb = await load(await exportTransactions(undefined, 'Oct 2026', { name: 'Ana Reyes', role: 'Admin' }));
    const ws = wb.getWorksheet('Transactions')!;

    expect(String(ws.getCell('B1').value)).toBe("Mylene's Boutique — Transactions");
    expect(String(ws.getCell('B2').value)).toContain('Plaza Mabini, Balayan, Batangas');
    expect(String(ws.getCell('B2').value)).toContain('Contact: 0917 123 4567');
    expect(String(ws.getCell('B3').value)).toContain('Period: Oct 2026');
    expect(String(ws.getCell('B4').value)).toContain('Exported by Ana Reyes (Admin)');
    expect(ws.getImages()).toHaveLength(1);

    // Table header on row 5, data from row 6.
    expect(ws.getCell('A5').value).toBe('Transaction ID');
    const feeCol = ws.getRow(5).values as unknown[];
    const fee = ws.getCell(6, feeCol.indexOf('Downpayment'));
    expect(fee.value).toBe(750.5);
    expect(fee.numFmt).toBe('₱#,##0.00');
    expect(fee.alignment?.horizontal).toBe('right');
    expect(ws.getCell(5, feeCol.indexOf('Downpayment')).alignment?.horizontal).toBe('right');
  });

  it('falls back to default business details when settings are empty', async () => {
    const wb = await load(await exportWorkbook(undefined, undefined, { name: 'Staff One', role: 'Staff' }));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Transactions', 'Revenue', 'Inventory']);
    for (const ws of wb.worksheets) {
      expect(String(ws.getCell('B1').value)).toContain("Mylene's Boutique");
      expect(String(ws.getCell('B2').value)).toContain('Balayan, Batangas');
      expect(String(ws.getCell('B4').value)).toContain('Exported by Staff One (Staff)');
    }
  });
});
