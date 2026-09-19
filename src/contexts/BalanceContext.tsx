"use client";

import {
  createContext, useContext, useState, useEffect, useRef, useCallback,
} from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

interface BalanceState {
  /** Total playable funds — the sum of the three pots below. */
  balance: string;        // formatted "0.00" — the raw ETB ledger number
  /** Funded by deposits: playable, not withdrawable. */
  depositBalance: string;
  /** Funded by bonuses: playable, not withdrawable. */
  bonusBalance: string;
  /** Won from gameplay — the only part that can be cashed out. */
  withdrawable: string;
  /** Lifetime XP — drives the tier ladder. Never goes down. */
  points: number | null;
  /** Spendable points wallet — what a redemption debits. */
  pointsBalance: number | null;
  streakDays: number | null;
  /** Unspent prize-wheel coupons. */
  spinCredits: number;
}

interface BalanceContextValue extends BalanceState {
  /** Force a re-fetch of the full balance/points/streak snapshot. */
  refresh: () => void;
}

const DEFAULT: BalanceState = {
  balance: "0.00",
  depositBalance: "0.00",
  bonusBalance: "0.00",
  withdrawable: "0.00",
  points: null,
  pointsBalance: null,
  streakDays: null,
  spinCredits: 0,
};

const BalanceContext = createContext<BalanceContextValue>({
  ...DEFAULT,
  refresh: () => {},
});

export function useBalance() {
  return useContext(BalanceContext);
}

export function BalanceProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [state, setState] = useState<BalanceState>(DEFAULT);

  // Full snapshot (balance + points + streak) — the source of truth on load,
  // and the fallback whenever the live stream can't carry points/streak.
  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch("/api/user/balance");
      if (!res.ok) return;
      const d = await res.json();
      setState((s) => ({
        ...s,
        balance: d.balance ?? s.balance,
        depositBalance: d.depositBalance ?? s.depositBalance,
        bonusBalance: d.bonusBalance ?? s.bonusBalance,
        withdrawable: d.withdrawable ?? s.withdrawable,
        points: typeof d.points === "number" ? d.points : s.points,
        pointsBalance: typeof d.pointsBalance === "number" ? d.pointsBalance : s.pointsBalance,
        streakDays: typeof d.streakDays === "number" ? d.streakDays : s.streakDays,
        spinCredits: typeof d.spinCredits === "number" ? d.spinCredits : s.spinCredits,
      }));
    } catch { /* ignore */ }
  }, [session]);

  // Reset + initial load on auth change
  useEffect(() => {
    if (!session) { setState(DEFAULT); return; }
    refresh();
  }, [session, refresh]);

  // Re-fetch points/streak after gameplay (dispatched by CasinoNav on game close)
  useEffect(() => {
    if (!session) return;
    const onActivity = () => refresh();
    window.addEventListener("vinna:activity", onActivity);
    return () => window.removeEventListener("vinna:activity", onActivity);
  }, [session, refresh]);

  // Live wallet stream — patches balance/turnover the instant a deposit is
  // approved or a game bet/win settles, and toasts deposit approvals anywhere.
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!session) { esRef.current?.close(); esRef.current = null; return; }

    const es = new EventSource("/api/user/balance/stream");
    esRef.current = es;

    es.onmessage = (e) => {
      let evt: {
        balance?: number; withdrawable?: number; reason?: string; amount?: number;
      };
      try { evt = JSON.parse(e.data); } catch { return; }

      setState((s) => {
        const balance = typeof evt.balance === "number" ? evt.balance.toFixed(2) : s.balance;
        // Withdrawable is derived server-side from the pots, so take it as given
        // rather than trying to recompute it from a partial event.
        const withdrawable = typeof evt.withdrawable === "number"
          ? evt.withdrawable.toFixed(2)
          : s.withdrawable;
        return { ...s, balance, withdrawable };
      });

      if (evt.reason === "deposit" && evt.amount) {
        toast.success("Deposit approved!", {
          description: `${formatCurrency(evt.amount)} has been added to your balance.`,
        });
        // points may have changed (first-deposit-of-week bonus)
        refresh();
      }

      // A bet/win/bonus event carries the total and withdrawable but not the
      // pot split, so pull the full snapshot to keep the deposit/bonus figures
      // honest.
      if (evt.reason === "bonus" || evt.reason === "bet" || evt.reason === "win") refresh();
    };

    es.onerror = () => {
      // EventSource auto-reconnects; if it permanently fails, fall back to a poll.
      refresh();
    };

    return () => { es.close(); esRef.current = null; };
  }, [session, refresh]);

  return (
    <BalanceContext.Provider value={{ ...state, refresh }}>
      {children}
    </BalanceContext.Provider>
  );
}
