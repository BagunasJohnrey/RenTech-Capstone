import { useCallback } from 'react';
import { promoService } from '../services';

export function usePromo() {
  const validate = useCallback((code, rentalFee, itemCategory) => promoService.validate({ code, rentalFee, itemCategory }), []);
  const list = useCallback(() => promoService.list(), []);
  const listPublic = useCallback(() => promoService.listPublic(), []);
  const eligible = useCallback((rentalFee, itemCategory) => promoService.eligible({ rentalFee, itemCategory }), []);
  return { validate, list, listPublic, eligible };
}
