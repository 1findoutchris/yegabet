"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { User, Gift, Ticket, SearchCheck, Settings, Download, LogOut } from "lucide-react";
import { useBalance } from "@/contexts/BalanceContext";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { getRankState } from "@/lib/retention";
import { RankBadge } from "@/components/retention/RankBadge";

/**
 * The round avatar at the far right of the header and its dropdown. Same
 * destinations the old account menu had, plus the tier progress that used to
 * sit in the header as its own chip.
 */
export function ProfileMenu() {
  const { data: session } = useSession();
  const { points } = useBalance();
  const { canPrompt: canInstall, install } = useInstallPrompt();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const name = session?.user?.name?.trim() || session?.user?.username || session?.user?.phone || "Player";
  const initial = name.charAt(0).toUpperCase();
  // Default ladder, as the old header chip used: a client widget with no
  // server parent to pass the admin-configured tiers.
  const rank = points === null ? null : getRankState(points);
  const close = () => setOpen(false);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="w-9 h-9 rounded-full grid place-items-center text-[13px] font-extrabold text-white bg-[var(--v-bg-4)] border border-[color:var(--v-line-2)] hover:border-[color:var(--v-teal-a24)] transition-colors"
      >
        {initial}
      </button>

      {open && (
        <div className="v-drop-in absolute right-0 top-11 w-64 rounded-[18px] v-glass shadow-[var(--v-shadow-3)] overflow-hidden z-50">
          <div className="px-4 pt-4 pb-3">
            <p className="text-[14px] font-bold text-white truncate">{name}</p>
            <p className="text-[12px] text-[color:var(--v-text-3)] truncate">{session?.user?.phone}</p>
            {rank && (
              <Link href="/rewards" onClick={close} className="mt-3 flex items-center gap-2.5 rounded-[12px] bg-[var(--v-bg-3)] px-3 py-2.5 hover:bg-[var(--v-bg-4)] transition-colors">
                <RankBadge tier={rank.tier} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-bold" style={{ color: rank.tier.color }}>{rank.tier.name}</span>
                    <span className="text-[11px] text-[color:var(--v-text-3)] tabular-nums">{rank.points.toLocaleString()} XP</span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-[var(--v-bg-1)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--v-teal)]" style={{ width: `${rank.progressPct}%` }} />
                  </div>
                </div>
              </Link>
            )}
          </div>
          <div className="border-t border-[color:var(--v-line)] py-1.5">
            <Item href="/account" icon={User} label="My account" onClick={close} />
            <Item href="/rewards" icon={Gift} label="Rewards" onClick={close} />
            <Item href="/tickets" icon={Ticket} label="Bet history" onClick={close} />
            <Item href="/check" icon={SearchCheck} label="Check ticket" onClick={close} />
            <Item href="/account/settings" icon={Settings} label="Settings" onClick={close} />
            {/* Only when a real one-tap install is on offer (no API on iOS). */}
            {canInstall && (
              <button onClick={() => { close(); install(); }} className={ROW}>
                <Download className="w-4 h-4 text-[color:var(--v-text-3)]" /> Install the app
              </button>
            )}
          </div>
          <div className="border-t border-[color:var(--v-line)] py-1.5">
            <button onClick={() => { close(); signOut({ callbackUrl: "/" }); }} className={ROW.replace("text-[color:var(--v-text-2)]", "text-[color:var(--v-red)]")}>
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const ROW = "w-full flex items-center gap-3 px-4 h-10 text-[13px] font-medium text-[color:var(--v-text-2)] hover:text-white hover:bg-[rgba(200, 200, 200,0.06)] transition-colors";

function Item({ href, icon: Icon, label, onClick }: { href: string; icon: typeof User; label: string; onClick: () => void }) {
  return (
    <Link href={href} onClick={onClick} className={ROW}>
      <Icon className="w-4 h-4 text-[color:var(--v-text-3)]" /> {label}
    </Link>
  );
}
