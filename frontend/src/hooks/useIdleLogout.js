import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

// Inactivity sign-out. Mouse, keyboard, touch and scrolling count as activity;
// the last activity time is shared between the app's open tabs (localStorage),
// so working in one tab keeps the others signed in. One minute before the
// limit a warning is shown; at the limit `onTimeout` runs.
const KEY = 'aun_last_activity';
const EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel', 'scroll'];
const WARN_MS = 60 * 1000;
const PING_MS = 2 * 60 * 1000; // keep the server session alive while active

let memoryLast = Date.now(); // fallback when storage is unavailable
const readLast = () => {
  try { return Number(localStorage.getItem(KEY)) || memoryLast; } catch { return memoryLast; }
};
const writeLast = (t) => {
  memoryLast = t;
  try { localStorage.setItem(KEY, String(t)); } catch { /* storage unavailable */ }
};

export function useIdleLogout({ minutes, onTimeout, enabled = true }) {
  const [secondsLeft, setSecondsLeft] = useState(null); // non-null = warning shown
  const lastWrite = useRef(0);
  const lastPing = useRef(Date.now());
  const timedOut = useRef(false);
  const onTimeoutRef = useRef(onTimeout); // latest callback without restarting the timer
  onTimeoutRef.current = onTimeout;
  const idleMs = minutes * 60 * 1000;

  const markActive = useCallback((force = false) => {
    const now = Date.now();
    if (force || now - lastWrite.current > 1000) { lastWrite.current = now; writeLast(now); }
    // the server session slides only when the server sees a request
    if (force || now - lastPing.current > PING_MS) {
      lastPing.current = now;
      api.get('/auth/me').catch(() => { /* a 401 is handled by the api client */ });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    timedOut.current = false;
    writeLast(Date.now());
    const onActivity = () => markActive();
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const tick = setInterval(() => {
      const idle = Date.now() - readLast();
      if (idle >= idleMs) {
        if (!timedOut.current) { timedOut.current = true; onTimeoutRef.current(); }
      } else if (idle >= idleMs - WARN_MS) {
        setSecondsLeft(Math.ceil((idleMs - idle) / 1000));
      } else {
        setSecondsLeft(null);
      }
    }, 1000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(tick);
    };
  }, [enabled, idleMs, markActive]);

  return { secondsLeft, stayActive: () => { markActive(true); setSecondsLeft(null); } };
}
