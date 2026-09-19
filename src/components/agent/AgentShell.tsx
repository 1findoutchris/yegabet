"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  Trophy, Ticket, BarChart3, ArrowDownToLine, ArrowUpFromLine,
  Menu, X, LogOut, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentTicketPanel } from "./AgentTicketPanel";

/*
 * Chrome for IN_PERSON_AGENT users — replaces the casino nav/tabbar with the
 * same vertical-sidebar pattern the payout portal uses. The agent is a normal
 * user under the hood; this shell is what restricts him to the sports rail.
 *
 * Route guard lives here (client-side, pathname-driven): anything outside the
 * allowed list bounces to /sports. Server-side, /agent/* pages also guard
 * themselves for non-agents in (user)/agent/layout.tsx.
 */

const ALLOWED_PREFIXES = ["/sports", "/agent", "/deposit", "/withdraw", "/withdrawals"];

const LINKS = [
  { href: "/sports", label: "Sports", icon: Trophy },
  { href: "/agent/tickets", label: "Tickets", icon: Ticket },
  { href: "/agent/stats", label: "Stats", icon: BarChart3 },
  { href: "/deposit", label: "Deposit", icon: ArrowDownToLine },
  { href: "/withdraw", label: "Withdraw", icon: ArrowUpFromLine },
];

export function AgentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const allowed = ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  useEffect(() => {
    if (!allowed) router.replace("/sports");
  }, [allowed, router]);

  if (!allowed) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }

  const nav = (
    <nav className="flex flex-col gap-1 p-3 flex-1">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} onClick={() => setSidebarOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-colors",
              active
                ? "bg-[var(--bg-accent-dim)] text-[color:var(--gold)] border border-[color:var(--border-accent)]"
                : "text-[color:var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[color:var(--text-primary)]"
            )}>
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarContent = (
    <>
      <div className="px-4 py-4 border-b border-[color:var(--border-muted)]">
        <p className="font-display text-[15px] font-extrabold text-[color:var(--text-primary)]">
          Vinna<span className="text-gold-grad">Bet</span>
        </p>
        <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">Betting Agent</p>
      </div>
      {nav}
      <div className="p-3 border-t border-[color:var(--border-muted)]">
        <div className="px-3 py-2 mb-1">
          <p className="text-[11px] text-[color:var(--text-muted)]">Logged in as</p>
          <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">
            {session?.user?.name ?? session?.user?.username}
          </p>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[color:var(--red)] hover:bg-[var(--bg-elevated)] transition-colors">
          <LogOut className="w-4 h-4" /> Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-[var(--bg-base)]">
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-[color:var(--border-muted)] bg-[var(--bg-surface)] fixed inset-y-0 left-0 z-30">
        {sidebarContent}
      </aside>

      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-12 flex items-center justify-between px-4 bg-[var(--bg-surface)] border-b border-[color:var(--border-muted)]">
        <p className="font-display text-[14px] font-extrabold text-[color:var(--text-primary)]">
          Vinna<span className="text-gold-grad">Bet</span>{" "}
          <span className="text-[color:var(--text-muted)] font-normal text-[12px]">Agent</span>
        </p>
        <button onClick={() => setSidebarOpen((v) => !v)} className="p-1.5 rounded-lg text-[color:var(--text-secondary)]">
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setSidebarOpen(false)}>
          <div className="w-56 h-full bg-[var(--bg-surface)] border-r border-[color:var(--border-muted)] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="h-12" />
            {sidebarContent}
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 pt-12 md:pt-0 md:pl-56 overflow-auto">{children}</main>

      {/* Open-ticket draft bar — visible on /sports while betting for a customer */}
      <AgentTicketPanel />
    </div>
  );
}
