// Drives the REAL maya.service against the local mock, proving the integration
// end-to-end with no merchant credentials.
process.env.MAYA_BASE_URL = 'http://127.0.0.1:4599';
process.env.MAYA_ENV = 'sandbox';

const { env } = await import('../src/config/env.js');
env.MAYA_BASE_URL = 'http://127.0.0.1:4599';
env.MAYA_PUBLIC_KEY = 'pk_mock';
env.MAYA_SECRET_KEY = 'sk_mock';

const { createQrPayment, retrievePayment, retrievePaymentStatus } =
  await import('../src/services/maya.service.js');

const charge = await createQrPayment(250, 'E2E probe — Champagne Glitter Debut Gown', {
  transactionId: 'tx-e2e',
  requestReferenceNumber: 'E2E-0001',
  redirectUrl: { success: 'http://localhost:5173/payment-return?tx=tx-e2e' },
});
console.log('1. createQrPayment ->');
console.log('   id        :', charge.id);
console.log('   amount    :', charge.amount, '(we asked for 250)');
console.log('   status    :', charge.status);
console.log('   expiresAt :', charge.expiresAt);
console.log('   redirect  :', charge.redirectUrl);

const before = await retrievePaymentStatus(charge.id);
console.log('\n2. status before paying ->', before.status);

const paid = await retrievePayment(charge.id);
console.log('3. authoritative retrieve ->', paid.status, '| amount', paid.amount, '| receipt', paid.receiptNumber ?? '(none)');

// Flip the mock to SUCCESS (what Maya's webhook + a real scan would do).
await fetch(`http://127.0.0.1:4599/__mock/pay/${charge.id}`, { method: 'POST' });

const after = await retrievePayment(charge.id);
console.log('\n4. after marking paid ->', after.status, '| amount', after.amount, '| receipt', after.receiptNumber);

console.log('\n5. assertions:');
console.log('   peso->centavo->peso round-trips exactly :', after.amount === 250);
console.log('   status transitions PENDING -> SUCCESS    :', before.status === 'PENDING' && after.status === 'SUCCESS');
console.log('   secret-key retrieve carries the amount  :', typeof after.amount === 'number' && after.amount > 0);
console.log('   receiptNumber present once settled       :', !!after.receiptNumber);
console.log('   ONE HOUR expiry advertised to the client :', (new Date(charge.expiresAt!).getTime() - Date.now()) > 59 * 60_000);
console.log('   qrCodeBody captured for future embedding  :', 'qrCodeBody' in charge);