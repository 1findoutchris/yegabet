"use client";

import { SessionProvider } from "next-auth/react";
import { NativeBridge } from "@/components/native/NativeBridge";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      {/* Native iOS/Android app only; renders nothing in a browser. */}
      <NativeBridge />
    </SessionProvider>
  );
}
