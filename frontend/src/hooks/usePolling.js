import { useEffect, useRef, useState, useCallback } from 'react';

// Poll an async function every `interval` ms while `active` is true.
export function usePolling(fn, { interval = 2500, active = true } = {}) {
  const [data, setData] = useState(null);
  const savedFn = useRef(fn);
  savedFn.current = fn;

  const tick = useCallback(async () => {
    try { setData(await savedFn.current()); } catch { /* ignore transient */ }
  }, []);

  useEffect(() => {
    tick();
    if (!active) return undefined;
    const id = setInterval(tick, interval);
    return () => clearInterval(id);
  }, [active, interval, tick]);

  return [data, tick];
}
