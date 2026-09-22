import { useState, useEffect } from 'react';
import { transactionsService } from '../services/transactions';

// Live status of a message's linked booking ('loading' | 'unknown' | status).
// Returns null when there is no linked booking.
export function useBookingStatus(transactionId) {
  const [bookingStatus, setBookingStatus] = useState(null);

  useEffect(() => {
    if (!transactionId) {
      setBookingStatus(null);
      return;
    }
    setBookingStatus('loading');
    let live = true;
    transactionsService
      .get(transactionId)
      .then((tx) => { if (live) setBookingStatus(tx?.status || 'unknown'); })
      .catch(() => { if (live) setBookingStatus('unknown'); });
    return () => { live = false; };
  }, [transactionId]);

  return bookingStatus;
}
