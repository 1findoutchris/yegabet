"use client";

import { useSession } from "next-auth/react";
import { ChevronRight, Play } from "lucide-react";
import { useGamePlayer } from "@/contexts/GamePlayerContext";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { GameCard } from "./GameCard";
import {
  ArtTreasure, ArtChip, IcTrophy, IcCoins, IcStreak, IcLevel,
} from "./MyCasinoArt";
import { getRankState, TIERS, type Tier } from "@/lib/retention";
import { PROVIDER_META } from "@/types/games";
import type { Game } from "@/types/games";

export interface MyCasinoStats {
  totalWagered: number;
  biggestWin: number;
  streakDays: number;
  points: number;
}

interface Props {
  recent: Game[];
  bigWin: Game | null;
  stats: MyCasinoStats;
  /** Admin-configured tier ladder; defaults to the built-in one. */
  tiers?: Tier[];
}

export function MyCasino({ recent, bigWin, stats, tiers = TIERS }: Props) {
  const { data: session } = useSession();
  const { open: openGame } = useGamePlayer();
  const { openLogin } = useAuthModal();
  // Stat amounts are ETB ledger values; show them in the viewer's currency (live rate).
  const etb = (n: number) => `ETB ${Math.round(Number(n)).toLocaleString()}`;

  const name = session?.user?.name?.split(" ")[0] ?? "Player";
  const initial = name.charAt(0).toUpperCase();
  const rank = getRankState(stats.points, 0, tiers);

  const winAmount = stats.biggestWin;
  const showBigWin = !!bigWin && winAmount > 0;
  const bigWinProvider = bigWin ? PROVIDER_META[bigWin.provider]?.name ?? bigWin.providerName ?? bigWin.provider : "";

  function playBig() {
    if (!bigWin) return;
    if (session) openGame(bigWin);
    else openLogin();
  }

  const statTiles = [
    { icon: <IcLevel className="w-4 h-4" />,  label: "Level",         value: rank.tier.name,            accent: rank.tier.color, bar: rank.progressPct },
    { icon: <IcTrophy className="w-4 h-4" />, label: "Biggest win",   value: etb(stats.biggestWin),     accent: "#2BD974" },
    { icon: <IcCoins className="w-4 h-4" />,  label: "Total wagered", value: etb(stats.totalWagered),   accent: "#2DD4BF" },
    { icon: <IcStreak className="w-4 h-4" />, label: "Day streak",    value: `${stats.streakDays} ${stats.streakDays === 1 ? "day" : "days"}`, accent: "#FF7A1A" },
  ];

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-[color:var(--border-base)] p-5 sm:p-7"
      style={{ background: "linear-gradient(155deg,#1B1430 0%,#12303C 55%,#120D18 100%)" }}
    >
      {/* decorative blooms */}
      <span aria-hidden className="pointer-events-none absolute -top-20 -right-16 w-72 h-72 rounded-full"
        style={{ background: "radial-gradient(circle,rgba(45,212,191,0.18),transparent 65%)" }} />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 w-72 h-72 rounded-full"
        style={{ background: "radial-gradient(circle,rgba(192,122,255,0.20),transparent 65%)" }} />

      {/* Header */}
      <div className="relative z-10 flex items-center gap-3 mb-5">
        <ArtChip className="w-11 h-11 shrink-0 drop-shadow-[0_3px_8px_rgba(192,122,255,0.5)]" />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--purple-2)]">My Casino</p>
          <h2 className="font-display text-[20px] sm:text-[24px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)] leading-tight truncate">
            Welcome back, {name}
          </h2>
        </div>
        {/* avatar + rank */}
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:block text-right">
            <p className="text-[11px] text-[color:var(--text-muted)]">Loyalty</p>
            <p className="font-display text-[15px] font-bold text-gold-grad tabular-nums leading-none">
              {stats.points.toLocaleString()}
            </p>
          </div>
          <div
            className="w-11 h-11 rounded-full grid place-items-center font-display font-extrabold text-[#1B1430] text-lg bg-gold-grad shrink-0"
            style={{ boxShadow: "0 0 18px rgba(45,212,191,0.45)" }}
          >
            {initial}
          </div>
        </div>
      </div>

      {/* Body: big payout + stats */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        {/* Recent big payout — only when there's a real recorded win */}
        {showBigWin && bigWin && (
          <button
            onClick={playBig}
            className="press group lg:col-span-2 relative overflow-hidden rounded-2xl p-5 text-left border border-[color:var(--green)]/30"
            style={{ background: "linear-gradient(135deg,rgba(43,217,116,0.14),rgba(20,16,29,0.4) 70%)" }}
          >
            <ArtTreasure className="pointer-events-none absolute -right-2 bottom-0 w-[46%] max-w-[200px] drop-shadow-[0_6px_14px_rgba(0,0,0,0.4)] transition-transform duration-300 group-hover:scale-105" />
            <div className="relative z-10 max-w-[60%]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--green)]/15 border border-[color:var(--green)]/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--green)]">
                ● Biggest win
              </span>
              <p className="mt-3 text-[13px] text-[color:var(--text-secondary)] truncate">{bigWin.gameNameEn}</p>
              <p
                className="font-display text-[30px] sm:text-[38px] font-extrabold tracking-[-0.02em] text-[color:var(--green)] leading-none mt-1 tabular-nums"
                style={{ textShadow: "0 0 22px rgba(43,217,116,0.45)" }}
              >
                {etb(winAmount)}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {bigWinProvider && (
                  <span className="rounded-md bg-black/30 px-2 py-1 text-[11px] font-bold text-[color:var(--gold-2)]">
                    {bigWinProvider}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-lg bg-gold-grad text-[#1B1430] px-3 py-1.5 text-[12px] font-bold group-hover:scale-[1.03] transition-transform">
                  <Play className="w-3.5 h-3.5 fill-current" /> Play again
                </span>
              </div>
            </div>
          </button>
        )}

        {/* Stat tiles */}
        <div className={showBigWin ? "grid grid-cols-2 gap-3" : "grid grid-cols-2 sm:grid-cols-4 gap-3 lg:col-span-3"}>
          {statTiles.map((s) => (
            <div
              key={s.label}
              className="relative overflow-hidden rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)]/70 p-3.5 flex flex-col justify-between"
            >
              <div className="flex items-center gap-1.5" style={{ color: s.accent }}>
                {s.icon}
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--text-muted)]">
                  {s.label}
                </span>
              </div>
              <p className="font-display text-[18px] font-extrabold tracking-[-0.02em] mt-2 tabular-nums" style={{ color: s.accent }}>
                {s.value}
              </p>
              {typeof s.bar === "number" && (
                <div className="mt-2 h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${s.bar}%`, background: s.accent }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Continue playing */}
      {recent.length > 0 && (
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-[14px] font-bold text-[color:var(--text-primary)]">Continue playing</h3>
            <span className="text-[11px] text-[color:var(--text-muted)]">picked for {name}</span>
            <ChevronRight className="w-4 h-4 text-[color:var(--text-muted)] ml-auto" />
          </div>
          <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1 snap-x">
            {recent.map((g) => (
              <GameCard key={g.gameID} game={g} className="snap-start w-[108px] sm:w-[124px] shrink-0" />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
