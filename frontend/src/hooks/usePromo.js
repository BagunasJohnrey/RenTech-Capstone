import { useCallback } from 'react';
import { promoService } from '../services';

export function usePromo() {
  const validate = useCallback((code, rentalFee) => promoService.validate({ code, rentalFee }), []);
  const list = useCallback(() => promoService.list(), []);
  const listPublic = useCallback(() => promoService.listPublic(), []);
  return { validate, list, listPublic };
}
