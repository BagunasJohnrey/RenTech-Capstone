import { useState, useRef, useCallback, useEffect } from 'react';

// Standardized button-guard: blocks double-clicks / rapid taps on async actions.
// Combines a synchronous ref (blocks same-tick re-entry, which state alone can't)
// with state (drives the disabled UI). Mirrors the ProcessReturnModal gold standard.
//
// Usage:
//   const { guarding, guard } = useButtonGuard();
//   <button disabled={guarding} onClick={() => guard(async () => { await api.post(...); })}>
//
// `guard` returns the fn's result (or undefined when blocked) and always resets,
// so errors never leave the button permanently disabled.
export function useButtonGuard() {
  const [guarding, setGuarding] = useState(false);
  const guardingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const guard = useCallback(async (fn) => {
    if (guardingRef.current) return undefined;
    guardingRef.current = true;
    setGuarding(true);
    try {
      return await fn();
    } finally {
      guardingRef.current = false;
      if (mountedRef.current) setGuarding(false);
    }
  }, []);

  return { guarding, guard };
}

export default useButtonGuard;
