"use client";

import { createContext, useContext, useState, useCallback } from "react";

type Tab = "login" | "register";

interface AuthModalContextType {
  open: boolean;
  tab: Tab;
  openLogin: () => void;
  openRegister: () => void;
  close: () => void;
  setTab: (tab: Tab) => void;
}

const AuthModalContext = createContext<AuthModalContextType>({
  open: false,
  tab: "login",
  openLogin: () => {},
  openRegister: () => {},
  close: () => {},
  setTab: () => {},
});

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("login");

  const openLogin = useCallback(() => { setTab("login"); setOpen(true); }, []);
  const openRegister = useCallback(() => { setTab("register"); setOpen(true); }, []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <AuthModalContext.Provider value={{ open, tab, openLogin, openRegister, close, setTab }}>
      {children}
    </AuthModalContext.Provider>
  );
}

export const useAuthModal = () => useContext(AuthModalContext);
