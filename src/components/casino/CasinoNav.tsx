"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Wallet, User, LogOut, Settings, Download, Ticket, Search, SearchCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthModal } from "@/contexts/AuthModalContext";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useGamePlayer } from "@/contexts/GamePlayerContext";
import { useBalance } from "@/contexts/BalanceContext";
import { RankChip } from "@/components/retention/RankChip";
import { StreakFlame } from "@/components/retention/StreakArt";

const NAV_LINKS = [
  { href: "/casino",  label: "Casino",   match: "/casino"  },
  { href: "/sports",  label: "Sports",   match: "/sports"  },
  { href: "/games",   label: "Games",    match: "/games"   },
  { href: "/rewards", label: "Rewards",  match: "/rewards" },
];

export function CasinoNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { canPrompt: canInstall, install } = useInstallPrompt();
  const { openLogin, openRegister } = useAuthModal();
  const { current } = useGamePlayer();
  // Wallet balance / points / streak come from the shared BalanceProvider,
  // which updates them live via the /api/user/balance/stream SSE connection.
  const { balance, points, streakDays, refresh } = useBalance();
  const shownBalance = Number(balance).toFixed(2);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // After a game closes, re-check points/streak (balance itself already updates
  // live via the wallet stream) and nudge the engagement watcher.
  const wasPlaying = useRef(false);
  useEffect(() => {
    const playing = !!current;
    if (wasPlaying.current && !playing) {
      refresh();
      window.dispatchEvent(new Event("vinna:activity"));
    }
    wasPlaying.current = playing;
  }, [current, refresh]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-[#0C2027]/80 backdrop-blur-xl border-b border-[color:var(--border-muted)]">
      <div className="max-w-7xl mx-auto h-full px-3 sm:px-6 flex items-center gap-2 sm:gap-8">

        {/* Logo */}
        <Link href="/casino" className="shrink-0 select-none">
          <span className="font-display text-xl font-extrabold tracking-[-0.04em] text-[color:var(--text-primary)]">
            Vinna<span className="text-gold-grad">Bet</span>
          </span>
        </Link>

        {/* Nav links — desktop */}
        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => {
            const active = !!link.match && pathname.startsWith(link.match);
            return (
              <Link
                key={link.label}
                href={link.href}
                className={cn(
                  "text-[13px] font-medium transition-colors duration-150 pb-0.5",
                  active
                    ? "text-[color:var(--text-primary)] border-b-2 border-[color:var(--gold)]"
                    : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* Engagement widget — rank progress (desktop) */}
        <RankChip points={points} />

        {/* Auth — right */}
        {session ? (
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            {/* Balance chip — visible on mobile too */}
            <button
              onClick={refresh}
              title="Click to refresh balance"
              className="flex items-center gap-1.5 h-8 px-2 sm:px-3 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] hover:border-[color:var(--border-accent)] transition-colors min-w-0"
            >
              <Wallet className="w-3.5 h-3.5 text-[color:var(--gold)] shrink-0" />
              <span className="text-[13px] font-bold text-[color:var(--gold)] tabular-nums truncate">{shownBalance}</span>
              <span className="text-[11px] text-[color:var(--text-muted)] shrink-0">ETB</span>
            </button>

            {/* Daily-play streak — links to the streak page, always shown (grey at 0) */}
            <Link
              href="/rewards/streak"
              title="Daily play streak"
              className="flex items-center gap-1.5 h-8 px-2 sm:px-3 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] hover:border-[color:var(--border-accent)] transition-colors shrink-0"
            >
              <StreakFlame days={streakDays ?? 0} active={(streakDays ?? 0) > 0} className="w-4 h-4 shrink-0" />
              <span className="text-[13px] font-bold text-[color:var(--text-primary)] tabular-nums">{streakDays ?? 0}</span>
              <span className="hidden sm:inline text-[11px] text-[color:var(--text-secondary)]">day</span>
            </Link>

            {/* Deposit — desktop (mobile uses the bottom-bar FAB) */}
            <Link href="/deposit" className="h-8 px-4 rounded-lg bg-gold-grad shine text-[#09090B] text-[13px] font-bold transition-transform hover:scale-[1.03] hidden sm:flex items-center">
              Deposit
            </Link>

            {/* User avatar + dropdown */}
            <div className="relative shrink-0" ref={menuRef}>
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="w-8 h-8 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] hover:border-[color:var(--border-accent)] flex items-center justify-center transition-colors"
              >
                <User className="w-4 h-4 text-[color:var(--text-secondary)]" />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 top-10 w-52 bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-xl shadow-2xl overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[color:var(--border-muted)]">
                    <p className="text-[color:var(--text-muted)] text-[11px]">Logged in as</p>
                    <p className="text-[color:var(--text-primary)] text-[13px] font-medium truncate mt-0.5">
                      {session.user?.phone}
                    </p>
                    <p className="text-[color:var(--gold)] text-[13px] font-bold mt-1">{shownBalance} ETB</p>
                  </div>
                  <div className="py-1">
                    <Link
                      href="/account"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <User className="w-4 h-4" />
                      My account
                    </Link>
                    <Link
                      href="/tickets"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <Ticket className="w-4 h-4" />
                      Ticket History
                    </Link>
                    <Link
                      href="/tickets?find=1"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <Search className="w-4 h-4" />
                      Find Ticket
                    </Link>
                    <Link
                      href="/check"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <SearchCheck className="w-4 h-4" />
                      Check Ticket
                    </Link>
                    <Link
                      href="/account/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      Settings
                    </Link>
                    {/* Only when a real one-tap install is on offer. iOS has no
                        API for it — those users get the banner's Share steps,
                        and a menu item that cannot do anything is worse than
                        no menu item. */}
                    {canInstall && (
                      <button
                        onClick={() => { setUserMenuOpen(false); install(); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Install the app
                      </button>
                    )}
                    <button
                      onClick={() => { setUserMenuOpen(false); signOut({ callbackUrl: "/" }); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[color:var(--red)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Log Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={openLogin}
              className="h-8 px-3 sm:px-4 rounded-lg text-[13px] font-medium text-[color:var(--text-secondary)] bg-transparent border border-[color:var(--border-base)] hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)] transition-colors"
            >
              Log in
            </button>
            <button
              onClick={openRegister}
              className="h-8 px-3 sm:px-4 rounded-lg bg-gold-grad shine text-[#09090B] text-[13px] font-bold transition-transform hover:scale-[1.03]"
            >
              Register
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
