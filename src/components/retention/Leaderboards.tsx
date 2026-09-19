"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Trophy, Crown, Loader2 } from "lucide-react";

const MEDAL = ["#F0A500", "#C7CCD1", "#CD7F32"]; // gold / silver / bronze for top 3

interface Entry { rank: number; label: string; value: string; you: boolean }
interface Board { id: string; title: string; metric: string; entries: Entry[] }

export function Leaderboards() {
  const { status } = useSession();
  const router = useRouter();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string>("volume");

  useEffect(() => {
    if (status !== "authenticated") { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch("/api/user/leaderboards")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { boards: Board[] } | null) => {
        if (!cancelled) { setBoards(d?.boards ?? null); setLoading(false); }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  const board = boards?.find((b) => b.id === active) ?? boards?.[0];

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-[18px] h-[18px] text-[color:var(--gold)]" />
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">Leaderboards</h3>
        <span className="text-[11px] text-[color:var(--text-muted)] ml-auto">Weekly · resets Monday 00:00 UTC</span>
      </div>

      {status !== "authenticated" ? (
        <p className="text-[13px] text-[color:var(--text-muted)]">Log in to see the leaderboards.</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-[color:var(--text-muted)] text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading leaderboards…
        </div>
      ) : !boards || !board ? (
        <p className="text-[13px] text-[color:var(--text-muted)]">Leaderboards are unavailable right now.</p>
      ) : (
        <>
          {/* Board tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1 mb-4 scrollbar-hide">
            {boards.map((b) => (
              <button
                key={b.id}
                onClick={() => setActive(b.id)}
                className={
                  "whitespace-nowrap px-4 py-[7px] rounded-lg text-[12px] transition-all duration-150 " +
                  (board.id === b.id
                    ? "bg-[var(--bg-accent-dim)] border border-[color:var(--gold)] text-[color:var(--gold)] font-semibold"
                    : "bg-[var(--bg-surface)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] font-medium hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)]")
                }
              >
                {b.title}
              </button>
            ))}
          </div>

          <div className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] overflow-hidden">
            <div className="px-5 py-3 border-b border-[color:var(--border-muted)]">
              <span className="text-[12px] text-[color:var(--text-secondary)]">{board.metric}</span>
            </div>

            {board.entries.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-[13px] text-[color:var(--text-secondary)]">No entries yet this week.</p>
                <p className="text-[12px] text-[color:var(--text-muted)] mt-1">Play to be the first on the board.</p>
              </div>
            ) : (
              <>
                {/* Podium — top 3 ordered 2 · 1 · 3 */}
                {(() => {
                  const top = board.entries.filter((e) => e.rank <= 3).sort((a, b) => a.rank - b.rank);
                  const order = [top[1], top[0], top[2]].filter(Boolean) as Entry[];
                  if (order.length === 0) return null;
                  return (
                    <div className="flex items-end justify-center gap-3 px-4 pt-6 pb-5" style={{ background: "linear-gradient(180deg, #1A0E2E, transparent)" }}>
                      {order.map((e) => {
                        const first = e.rank === 1;
                        const c = MEDAL[e.rank - 1];
                        return (
                          <div key={e.rank} className="flex flex-col items-center w-[30%] max-w-[120px]">
                            {first && <Crown className="w-5 h-5 mb-1 text-[color:var(--gold)] animate-float" />}
                            <span
                              className="rounded-full flex items-center justify-center font-display font-extrabold text-[#09090B]"
                              style={{ width: first ? 52 : 42, height: first ? 52 : 42, background: c, boxShadow: first ? "var(--glow-gold)" : undefined }}
                            >
                              {e.label.charAt(0).toUpperCase()}
                            </span>
                            <span className="mt-1.5 text-[12px] font-medium text-[color:var(--text-primary)] truncate max-w-full">
                              {e.you ? "You" : e.label}
                            </span>
                            <span className="text-[11px] font-bold text-[color:var(--gold)] tabular-nums">{e.value}</span>
                            <div
                              className="mt-2 w-full rounded-t-lg flex items-start justify-center pt-1.5 font-display font-extrabold text-[#09090B]"
                              style={{ height: first ? 70 : 46, background: `linear-gradient(180deg, ${c}, transparent)`, opacity: 0.9 }}
                            >
                              {e.rank}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                <div className="divide-y divide-[color:var(--border-muted)]">
                  {board.entries.filter((e) => e.rank >= 4).map((e) => (
                    <div
                      key={e.rank}
                      className="flex items-center gap-3 px-5 py-3"
                      style={e.you ? { background: "var(--bg-accent-dim)" } : undefined}
                    >
                      <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold bg-[var(--bg-elevated)] text-[color:var(--text-secondary)]">
                        {e.rank}
                      </span>
                      <span className="flex-1 text-[13px] font-medium text-[color:var(--text-primary)] truncate">
                        {e.you ? "You" : e.label}
                        {e.you && <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--gold)]">You</span>}
                      </span>
                      <span className="text-[13px] font-bold text-[color:var(--text-primary)] tabular-nums">{e.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
