import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useState } from "react";

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider as RadixToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

export type ToastVariant = "default" | "success" | "warning" | "error";
export type ToastInput = {
  title: string;
  description?: string;
  variant: ToastVariant;
};

type ToastNotice = ToastInput & { id: string };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

function createToastId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within ToastProvider.");
  return toast;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const notify = useCallback((toast: ToastInput) => {
    setToasts((current) => [...current, { ...toast, id: createToastId() }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <RadixToastProvider>
      <ToastContext.Provider value={notify}>
        {children}
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            onOpenChange={(open) => {
              if (!open) removeToast(toast.id);
            }}
            variant={toast.variant}
          >
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastContext.Provider>
    </RadixToastProvider>
  );
}
