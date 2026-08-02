import { useAsync } from './useAsync';
import { useCallback } from 'react';

/**
 * Convenience wrapper: fetch a resource on mount and expose
 * reload / mutate helpers. Components never call `api` directly.
 *
 * const { data, loading, error, reload } = useApiQuery(() => svc.list());
 */
export function useApiQuery(queryFn, { immediate = true, initialArgs = [] } = {}) {
  const { data, loading, error, execute, setData } = useAsync(queryFn, {
    immediate,
    initialArgs,
  });

  const reload = useCallback(() => execute(), [execute]);

  return { data, loading, error, reload, setData, execute };
}
