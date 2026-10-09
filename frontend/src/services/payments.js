import { api } from '../utils/api';

// Payments (PayMongo / Maya QRPh) API calls.
export const paymentsService = {
  createIntent: ({ transactionId, amount }) =>
    api.post('/payments/create-intent', { transactionId, amount }),

  get: (id) => api.get(`/payments/${id}`),

  // Coarse payment status for a booking. Also the self-heal path: if a Maya
  // webhook never landed, polling this credits the payment server-side.
  getStatus: (transactionId) => api.get(`/payments/transaction/${transactionId}/status`),
};
