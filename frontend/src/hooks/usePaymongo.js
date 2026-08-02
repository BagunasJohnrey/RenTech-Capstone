import { useEffect, useState } from 'react';

const PAYMONGO_SRC = 'https://cdn.paymongo.com/v2/paymongo.js';

// Loads the PayMongo drop-in SDK and exposes openDropIn(clientKey).
export function usePaymongo() {
  const [ready, setReady] = useState(typeof window !== 'undefined' && !!window.Paymongo);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (window.Paymongo) {
      setReady(true);
      return;
    }
    let script = document.querySelector(`script[src="${PAYMONGO_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = PAYMONGO_SRC;
      script.async = true;
      script.onload = () => setReady(true);
      script.onerror = () => setError('Failed to load PayMongo SDK');
      document.body.appendChild(script);
    } else {
      script.addEventListener('load', () => setReady(true));
    }
  }, []);

  const openDropIn = (clientKey, options = {}) => {
    return new Promise((resolve, reject) => {
      if (!window.Paymongo) {
        reject(new Error('PayMongo SDK not loaded'));
        return;
      }
      try {
        const paymongo = new window.Paymongo();
        const dropIn = paymongo.dropIn({
          clientKey,
          paymentMethods: ['gcash', 'card', 'paymaya'],
          ...options,
        });
        dropIn
          .open()
          .then((result) => resolve(result))
          .catch((err) => reject(err));
      } catch (err) {
        reject(err);
      }
    });
  };

  return { ready, error, openDropIn };
}
