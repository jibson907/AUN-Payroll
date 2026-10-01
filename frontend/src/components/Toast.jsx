import { createContext, useContext, useCallback, useState } from 'react';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((cur) => [...cur, { id, ...t }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), t.duration || 4200);
  }, []);
  const toast = {
    success: (title, msg) => push({ type: 'success', title, msg }),
    error: (title, msg) => push({ type: 'error', title, msg }),
    info: (title, msg) => push({ type: 'info', title, msg }),
  };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <b>{t.title}</b>
            {t.msg && <span>{t.msg}</span>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
