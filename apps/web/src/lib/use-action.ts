'use client';
import { useCallback, useState } from 'react';

/** Busy and error state for one-off mutations. `run` resolves true when the action succeeded. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, run, setError };
}
