import { api } from '../utils/api';

// Payments (PayMongo) API calls.
export const paymentsService = {
  createIntent: ({ transactionId, amount }) =>
    api.post('/payments/create-intent', { transactionId, amount }),

  get: (id) => api.get(`/payments/${id}`),
};
