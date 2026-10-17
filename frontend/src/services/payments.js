import { api } from '../utils/api';

// Payments (PayMongo / Maya QRPh) API calls.
export const paymentsService = {
  createIntent: ({ transactionId, amount }) =>
    api.post('/payments/create-intent', { transactionId, amount }),

  get: (id) => api.get(`/payments/${id}`),

  // Coarse payment status for a booking. Also the self-heal path: if a Maya
  // webhook never landed, polling this credits the payment server-side.
  getStatus: (transactionId) => api.get(`/payments/transaction/${transactionId}/status`),

  // Manual QR proof workflow: customer uploads a screenshot, staff review the
  // queue (approve credits through the ledger, reject lets the customer retry).
  submitProof: (bookingId, payload) => api.post(`/bookings/${bookingId}/payment-proof`, payload),
  listProofs: (limit) => api.get(`/payments/proofs${limit ? `?limit=${limit}` : ''}`),
  approveProof: (proofId, amount) => api.post(`/payments/proofs/${proofId}/approve`, amount != null ? { amount } : {}),
  rejectProof: (proofId, reason) => api.post(`/payments/proofs/${proofId}/reject`, { reason }),
};

// Named aliases so the booking flow / queue hook can import them directly —
// this file's other consumers use the paymentsService object above.
export const { submitProof, listProofs, approveProof, rejectProof } = paymentsService;
