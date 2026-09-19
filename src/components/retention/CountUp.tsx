"use client";

import { useEffect, useState } from "react";

interface Props {
  value: number;
  durationMs?: number;
  className?: string;
  format?: (n: number) => string;
}

/** Animates a number from 0 → value on mount (eased). Respects reduced-motion. */
export function CountUp({ value, durationMs = 1200, className, format }: Props) {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setN(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <span className={className}>{format ? format(n) : n.toLocaleString()}</span>;
}
