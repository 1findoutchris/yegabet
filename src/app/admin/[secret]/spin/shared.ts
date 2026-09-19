"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminFetch } from "../useAdmin";

/* Types and the /spin read shared by the wheel's section pages (see
   ./layout.tsx). Not a `page.tsx`, so the App Router doesn't route it.
   Mirrors ../rewards/useRewardConfig. */

export type PrizeKind = "CASH" | "PHYSICAL" | "SPIN" | "NONE";

export const KIND_LABEL: Record<PrizeKind, string> = {
  CASH: "Cash",
  PHYSICAL: "Physical",
  SPIN: "Free spins",
  NONE: "Try again",
};

export interface Prize {
  id: string;
  label: string;
  kind: PrizeKind;
  cashEtb: number;
  creditsAwarded: number;
  payoutPot: "bonus" | "withdrawable";
  weightBps: number;
  stock: number;
  sortOrder: number;
  isActive: boolean;
  imageUrl: string | null;
}

export interface PhysicalWin {
  id: string;
  label: string;
  createdAt: string;
  accountNo: number | null;
  phone: string;
  username: string;
}

export interface WheelCfg {
  enabled: boolean;
  creditsPerReferral: number;
  maxCreditsPerWeek: number;
  signupCredits: number;
}

export const FIELD =
  "w-full h-9 px-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]";

/** Chance is stored in basis points; admins think in percent. */
export const toPct = (bps: number) => bps / 100;
export const toBps = (pct: number) => Math.round(pct * 100);

/**
 * One GET /spin serves prizes and physical wins. Both the prizes and links
 * pages need the prize list, so the read is shared rather than the API growing
 * a per-section endpoint.
 */
export function useSpin() {
  const adminFetch = useAdminFetch();
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wins, setWins] = useState<PhysicalWin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch("/spin");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPrizes(data.prizes);
      setWins(data.physicalWins);
    } catch {
      setError("Failed to load the wheel.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  return { prizes, setPrizes, wins, loading, error, setError, adminFetch, reload: load };
}
