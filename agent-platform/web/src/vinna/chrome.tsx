import { CircleUserRound, Radio, Rocket, Search, Spade, Wallet } from "lucide-react";
import { formatSantim } from "../lib/money";
import { useSession } from "../session";
import { useLoad } from "../ui";
import { api } from "../lib/api";
import { cn } from "./cn";
import { VMark } from "./VMark";

type Section = "live" | "casino" | "games" | "wallet" | "account" | null;

/** Which tab a "#/…" route belongs to. */
export function sectionOf(route: string): Section {
  if (route.startsWith("/c/live")) return "live";
  if (route.startsWith("/games")) return "games";
  if (route.startsWith("/deposit") || route.startsWith("/withdraw")) return "wallet";
  if (route.startsWith("/account") || route.startsWith("/login")) return "account";
  return "casino";
}

const TABS: { id: Section; href: string; label: string }[] = [
  { id: "live", href: "#/c/live", label: "Live" },
  { id: "casino", href: "#/", label: "Casino" },
  { id: "games", href: "#/games", label: "Games" },
];

/**
 * The YegaBet mark + wordmark, and next to it the agent's name when the visit
 * came through an agent's link or the player belongs to an agent.
 */
export function Logo() {
  const { agentName } = useSession();
  return (
    <a
      href="#/"
      aria-label="YegaBet home"
      className="shrink-0 inline-flex items-center gap-2 select-none min-w-0"
    >
      <VMark size={30} />
      <span className="text-[14px] font-extrabold tracking-[0.2em] text-white leading-none">
        YEGA<span className="text-[color:var(--v-teal)]">BET</span>
      </span>
      {agentName && (
        <span className="ml-1 pl-2 border-l border-[color:var(--v-line-2)] text-[13px] font-bold text-[color:var(--v-text-2)] truncate max-w-[30vw] sm:max-w-[220px]">
          {agentName}
        </span>
      )}
    </a>
  );
}

/** The old site's header: 56px, glass, logo left, section switcher (desktop), search, balance or Log in / Join. */
export function AppHeader({ route }: { route: string }) {
  const { me } = useSession();
  const active = sectionOf(route);
  const idx = TABS.findIndex((t) => t.id === active);
  const wallet = useLoad(
    () => (me?.kind === "player" ? api<{ availableSantim: string }>("/me/wallet") : Promise.resolve(null)),
    [me?.kind, route],
  );
  return (
    <header className="fixed top-0 inset-x-0 z-50 h-14 v-glass border-x-0 border-t-0">
      <div className="max-w-7xl mx-auto h-full px-3 sm:px-6 flex items-center gap-2 sm:gap-4">
        <Logo />
        <nav
          className="hidden md:flex relative mx-auto p-1 rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line)]"
          aria-label="Sections"
        >
          {idx >= 0 && (
            <span
              aria-hidden
              className="absolute top-1 bottom-1 left-1 w-[88px] rounded-full bg-[var(--v-bg-4)] shadow-[inset_0_0_0_1px_var(--v-teal-a24)] transition-transform duration-[260ms]"
              style={{ transform: `translateX(${idx * 88}px)` }}
            />
          )}
          {TABS.map((t) => (
            <a
              key={t.label}
              href={t.href}
              aria-current={active === t.id ? "page" : undefined}
              className={cn(
                "relative z-10 w-[88px] h-8 grid place-items-center rounded-full text-[13px] font-semibold transition-colors",
                active === t.id
                  ? "text-white"
                  : "text-[color:var(--v-text-3)] hover:text-[color:var(--v-text-2)]",
              )}
            >
              {t.label}
            </a>
          ))}
        </nav>
        <div className="flex-1 md:flex-none" />
        <a
          href="#/search"
          aria-label="Search games"
          className="shrink-0 w-9 h-9 grid place-items-center rounded-full text-[color:var(--v-text-2)] hover:text-white hover:bg-[var(--v-bg-3)] transition-colors"
        >
          <Search className="w-[18px] h-[18px]" />
        </a>
        {me?.kind === "player" ? (
          <a
            href="#/deposit"
            className="shrink-0 inline-flex items-center gap-2 h-9 pl-3 pr-1 rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line)]"
          >
            <span className="text-[13px] font-bold tabular-nums text-white">
              {wallet.data ? formatSantim(wallet.data.availableSantim) : "…"}{" "}
              <span className="text-[color:var(--v-text-3)]">ETB</span>
            </span>
            <span className="h-7 px-3 grid place-items-center rounded-full text-[12px] font-bold bg-[var(--v-teal)] text-[color:var(--v-teal-ink)]">
              Deposit
            </span>
          </a>
        ) : me ? (
          <a
            href={me.kind === "staff" ? "#/admin" : "#/agent"}
            className="h-9 px-4 grid place-items-center rounded-full text-[13px] font-bold bg-[var(--v-teal)] text-[color:var(--v-teal-ink)]"
          >
            {me.kind === "staff" ? "Admin" : "Agent desk"}
          </a>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href="#/login"
              className="h-9 px-3.5 grid place-items-center rounded-full text-[13px] font-semibold text-white hover:bg-[var(--v-bg-3)] transition-colors"
            >
              Log in
            </a>
            <a
              href="#/login"
              className="h-9 px-4 grid place-items-center rounded-full text-[13px] font-bold bg-[var(--v-teal)] text-[color:var(--v-teal-ink)] hover:bg-[#FF8F26] transition-all"
            >
              Join
            </a>
          </div>
        )}
      </div>
    </header>
  );
}

const BOTTOM: { id: Section; href: string; label: string; icon: typeof Spade }[] = [
  { id: "live", href: "#/c/live", label: "Live", icon: Radio },
  { id: "casino", href: "#/", label: "Casino", icon: Spade },
  { id: "games", href: "#/games", label: "Games", icon: Rocket },
  { id: "wallet", href: "#/deposit", label: "Wallet", icon: Wallet },
  { id: "account", href: "#/account", label: "Account", icon: CircleUserRound },
];

/** Phone navigation, as on the old site (Sports and Rewards aren't on the new platform). */
export function BottomNav({ route }: { route: string }) {
  const active = sectionOf(route);
  const idx = BOTTOM.findIndex((t) => t.id === active);
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 v-glass border-x-0 border-b-0"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <div className="relative grid grid-cols-5 h-16">
        {idx >= 0 && (
          <span
            aria-hidden
            className="absolute top-0 h-[3px] w-[20%] flex justify-center transition-transform duration-[260ms]"
            style={{ transform: `translateX(${idx * 100}%)` }}
          >
            <span className="h-full w-7 rounded-b-full bg-[var(--v-teal)] shadow-[0_0_14px_rgba(255,122,0,0.7)]" />
          </span>
        )}
        {BOTTOM.map((t) => {
          const on = t.id === active;
          const Icon = t.icon;
          return (
            <a
              key={t.label}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className="relative flex flex-col items-center justify-center gap-1 v-press"
            >
              <span
                className={cn(
                  "grid place-items-center w-11 h-7 rounded-full transition-all duration-[220ms]",
                  on ? "bg-[var(--v-teal-a12)] -translate-y-0.5" : "bg-transparent",
                )}
              >
                <Icon
                  className={cn(
                    "w-[19px] h-[19px]",
                    on ? "text-[color:var(--v-teal)]" : "text-[color:var(--v-text-3)]",
                  )}
                  strokeWidth={on ? 2.3 : 1.9}
                />
              </span>
              <span
                className={cn(
                  "text-[10.5px] font-semibold tracking-[0.01em]",
                  on ? "text-white" : "text-[color:var(--v-text-3)]",
                )}
              >
                {t.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[color:var(--v-line)] mb-16 md:mb-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-[12px] font-extrabold tracking-[0.2em] text-[color:var(--v-text-3)]">
          YEGABET
        </span>
        <span className="text-[12px] text-[color:var(--v-text-3)]">Responsible gaming</span>
        <span className="text-[12px] text-[color:var(--v-text-3)]">Terms &amp; conditions</span>
        <span className="text-[12px] text-[color:var(--v-text-3)]">Help center</span>
        <span className="ml-auto text-[11px] font-bold text-[color:var(--v-text-2)] border border-[color:var(--v-line-2)] rounded-full px-2 py-0.5">
          18+
        </span>
      </div>
    </footer>
  );
}
