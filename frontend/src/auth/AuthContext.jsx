import { createContext, useContext, useEffect, useState } from 'react';
import { api, setCsrfToken } from '../services/api';
import { LOGIN_PATH } from '../config';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // The session is an HttpOnly cookie — ask the server whether it is valid.
  useEffect(() => {
    (async () => {
      try {
        const { user: u, csrfToken } = await api.get('/auth/me');
        setCsrfToken(csrfToken);
        setUser(u);
      } catch {
        setCsrfToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email, password) {
    const { user: u, csrfToken } = await api.post('/auth/login', { email, password });
    setCsrfToken(csrfToken);
    setUser(u);
    return u;
  }

  // Server-side logout: the session is revoked on the server, not just forgotten here.
  async function logout() {
    try { await api.post('/auth/logout'); } catch { /* already signed out */ }
    setCsrfToken(null);
    setUser(null);
    location.href = LOGIN_PATH;
  }

  return <AuthCtx.Provider value={{ user, loading, login, logout, setUser }}>{children}</AuthCtx.Provider>;
}
