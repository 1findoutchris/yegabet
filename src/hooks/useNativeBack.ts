"use client";

import { useEffect, useRef } from "react";
import { NATIVE_BACK_EVENT } from "@/lib/native";

/**
 * While `active`, the Android back button in the native app calls `onBack`
 * (closing this overlay) instead of navigating. No effect in a browser.
 */
export function useNativeBack(active: boolean, onBack: () => void) {
  const ref = useRef(onBack);
  useEffect(() => {
    ref.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) return;
    const handler = (e: Event) => {
      e.preventDefault();
      ref.current();
    };
    window.addEventListener(NATIVE_BACK_EVENT, handler);
    return () => window.removeEventListener(NATIVE_BACK_EVENT, handler);
  }, [active]);
}
