import { useCallback } from 'react';
import { paymentsService } from '../services';

export function usePayments() {
  const createIntent = useCallback(
    ({ transactionId, amount }) => paymentsService.createIntent({ transactionId, amount }),
    []
  );
  const get = useCallback((id) => paymentsService.get(id), []);
  const getStatus = useCallback((transactionId) => paymentsService.getStatus(transactionId), []);
  return { createIntent, get, getStatus };
}
