"use client";

import { useSession } from "next-auth/react";
import { Play, Gauge, Trophy, Coins, Flame } from "lucide-react";
import { useGamePlayer } from "@/contexts/GamePlayerContext";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { GameCarousel } from "@/components/vinna/GameCarousel";
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
    { icon: <Gauge className="w-4 h-4" />,    label: "Level",         value: rank.tier.name,          accent: rank.tier.color, bar: rank.progressPct },
    { icon: <Trophy className="w-4 h-4" />,   label: "Biggest win",   value: etb(stats.biggestWin),   accent: "var(--v-green)" },
    { icon: <Coins className="w-4 h-4" />,    label: "Total wagered", value: etb(stats.totalWagered), accent: "var(--v-teal)" },
    { icon: <Flame className="w-4 h-4" />,    label: "Day streak",    value: `${stats.streakDays} ${stats.streakDays === 1 ? "day" : "days"}`, accent: "var(--v-amber)" },
  ];

  return (
    <section className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full grid place-items-center text-[18px] font-extrabold text-white bg-[var(--v-bg-4)] border border-[color:var(--v-line-2)] shrink-0">
          {initial}
        </div>
        <div className="min-w-0">
          <p className="v-eyebrow text-[color:var(--v-teal)]">My Casino</p>
          <h1 className="mt-1 text-[24px] sm:text-[28px] font-extrabold tracking-[-0.03em] text-white leading-tight truncate">
            Welcome back, {name}
          </h1>
        </div>
        <div className="ml-auto hidden sm:block text-right">
          <p className="v-eyebrow">XP</p>
          <p className="text-[18px] font-extrabold text-white tabular-nums leading-none mt-1">{stats.points.toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Biggest recorded win — only when there is one */}
        {showBigWin && bigWin && (
          <button
            onClick={playBig}
            className="v-press group lg:col-span-2 v-surface p-5 text-left flex items-center gap-4 hover:border-[color:var(--v-line-2)] transition-colors"
          >
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--v-green)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--v-green)]" /> Biggest win
              </span>
              <p className="mt-2 text-[34px] sm:text-[40px] font-extrabold tracking-[-0.03em] text-white leading-none tabular-nums">
                {etb(winAmount)}
              </p>
              <p className="mt-2 text-[13px] text-[color:var(--v-text-2)] truncate">
                {bigWin.gameNameEn}{bigWinProvider && <span className="text-[color:var(--v-text-3)]"> · {bigWinProvider}</span>}
              </p>
            </div>
            <span className="v-btn v-btn-primary h-11 rounded-full shrink-0">
              <Play className="w-4 h-4 fill-current" /> <span className="hidden sm:inline">Play again</span>
            </span>
          </button>
        )}

        <div className={showBigWin ? "grid grid-cols-2 gap-3" : "grid grid-cols-2 sm:grid-cols-4 gap-3 lg:col-span-3"}>
          {statTiles.map((s) => (
            <div key={s.label} className="v-surface p-4 flex flex-col justify-between min-w-0">
              <div className="flex items-center gap-1.5" style={{ color: s.accent }}>
                {s.icon}
                <span className="text-[11px] font-semibold text-[color:var(--v-text-3)] truncate">{s.label}</span>
              </div>
              <p className="text-[18px] font-extrabold tracking-[-0.02em] mt-2 tabular-nums text-white truncate">{s.value}</p>
              {typeof s.bar === "number" && (
                <div className="mt-2 h-1 rounded-full bg-[var(--v-bg-3)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${s.bar}%`, background: s.accent }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {recent.length > 0 && (
        <GameCarousel title="Continue playing" description={`Picked up where you left off, ${name}`} games={recent} />
      )}
    </section>
  );
}
