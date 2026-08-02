import { useState, useCallback, useEffect } from 'react';

/**
 * Generic async-state hook. Isolates loading / error / data lifecycle
 * so components stay presentational (SRP / SoC).
 *
 * const { data, loading, error, execute } = useAsync(fn, { immediate: true });
 */
export function useAsync(asyncFn, options = {}) {
  const { immediate = false, initialArgs = [] } = options;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);

  const execute = useCallback(
    async (...args) => {
      setLoading(true);
      setError(null);
      try {
        const result = await asyncFn(...args);
        setData(result);
        return result;
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [asyncFn]
  );

  useEffect(() => {
    if (immediate) {
      execute(...initialArgs).catch(() => {});
    }
    // run once on mount when immediate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, error, execute, setData };
}
