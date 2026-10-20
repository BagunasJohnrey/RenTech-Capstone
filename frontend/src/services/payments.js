import { api } from '../utils/api';

// Static-QR payment proof API calls. The customer uploads a screenshot and
// staff approve or reject it; approval is the only action that moves money.
export const paymentsService = {
  // Manual QR proof workflow: customer uploads a screenshot, staff review the
  // queue (approve credits through the ledger, reject lets the customer retry).
  submitProof: (bookingId, payload) => api.post(`/bookings/${bookingId}/payment-proof`, payload),
  // Customer's own QR proof history (pending / approved / rejected).
  myProofs: (limit) => api.get(`/bookings/payment-proofs${limit ? `?limit=${limit}` : ''}`),
  listProofs: (limit) => api.get(`/payments/proofs${limit ? `?limit=${limit}` : ''}`),
  approveProof: (proofId, amount) => api.post(`/payments/proofs/${proofId}/approve`, amount != null ? { amount } : {}),
  rejectProof: (proofId, reason) => api.post(`/payments/proofs/${proofId}/reject`, { reason }),
};

// Named aliases so the booking flow / queue hook can import them directly —
// this file's other consumers use the paymentsService object above.
export const { submitProof, listProofs, approveProof, rejectProof, myProofs } = paymentsService;
