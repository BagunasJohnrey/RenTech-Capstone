import { useState, useEffect } from 'react';

// Debounces a fast-changing value (search inputs, typing-driven filters).
// Returns the value only after it stops changing for `delay` ms.
// Buttons don't need this — they need useButtonGuard (blocking, not delaying).
//
// Usage:
//   const debouncedQuery = useDebounce(query, 300);
//   useEffect(() => { runSearch(debouncedQuery); }, [debouncedQuery]);
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebounce;
