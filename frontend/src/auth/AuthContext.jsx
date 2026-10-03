import { createContext, useContext, useEffect, useState } from 'react';
import { api, setCsrfToken } from '../services/api';
import { LOGIN_PATH } from '../config';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [idleMinutes, setIdleMinutes] = useState(10); // inactivity sign-out, from the server

  // The session is an HttpOnly cookie — ask the server whether it is valid.
  useEffect(() => {
    (async () => {
      try {
        const { user: u, csrfToken, sessionIdleMinutes } = await api.get('/auth/me');
        setCsrfToken(csrfToken);
        if (sessionIdleMinutes) setIdleMinutes(sessionIdleMinutes);
        setUser(u);
      } catch {
        setCsrfToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email, password) {
    const { user: u, csrfToken, sessionIdleMinutes } = await api.post('/auth/login', { email, password });
    setCsrfToken(csrfToken);
    if (sessionIdleMinutes) setIdleMinutes(sessionIdleMinutes);
    setUser(u);
    return u;
  }

  // Server-side logout: the session is revoked on the server, not just forgotten here.
  // reason "idle" = automatic sign-out after inactivity (ends this browser's session only).
  async function logout(reason) {
    const idle = reason === 'idle';
    try { await api.post('/auth/logout', idle ? { reason: 'idle' } : undefined); } catch { /* already signed out */ }
    setCsrfToken(null);
    setUser(null);
    location.href = idle ? `${LOGIN_PATH}?idle=1` : LOGIN_PATH;
  }

  return <AuthCtx.Provider value={{
    user, loading, login, logout, setUser, idleMinutes,
  }}>{children}</AuthCtx.Provider>;
}
