import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

type Show = (message: string, kind?: ToastKind) => void;
const ToastContext = createContext<Show | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback<Show>(
    (message, kind = 'info') => {
      const id = nextId.current++;
      setToasts((all) => [...all.filter((t) => t.message !== message), { id, kind, message }].slice(-4));
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.message}</span>
            <button className="icon-button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Show {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>.');
  return ctx;
}
