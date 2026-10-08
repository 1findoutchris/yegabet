"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, ArrowDownLeft, ArrowUpRight, Users,
  Menu, X, LogOut, BarChart3, Loader2, CreditCard, Gift, Send, Megaphone, LayoutTemplate, Disc3,
  MessageSquareText, Smartphone, HandCoins, Percent, Store,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { secret } = useParams<{ secret: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [adminUser, setAdminUser] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isLoginPage = pathname?.endsWith("/login");

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/auth/check", {
        headers: { "x-admin-secret": secret },
      });
      if (res.ok) {
        const d = await res.json();
        setAdminUser(d.username);
        setAuthed(true);
      } else {
        setAuthed(false);
        if (!isLoginPage) router.replace(`/admin/${secret}/login`);
      }
    } catch {
      setAuthed(false);
      if (!isLoginPage) router.replace(`/admin/${secret}/login`);
    } finally {
      setChecking(false);
    }
  }, [secret, isLoginPage, router]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    setAuthed(false);
    router.replace(`/admin/${secret}/login`);
  }

  // Login page renders without sidebar
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Still checking auth
  if (checking) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }

  // Not authed — router.replace is already queued above, show blank while redirecting
  if (!authed) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)]" />
    );
  }

  const base = `/admin/${secret}`;
  const links = [
    { href: base,                  label: "Overview",    icon: LayoutDashboard },
    { href: `${base}/deposits`,    label: "Deposits",    icon: ArrowDownLeft },
    { href: `${base}/withdrawals`, label: "Withdrawals", icon: ArrowUpRight },
    { href: `${base}/users`,       label: "Users",       icon: Users },
    { href: `${base}/reports`,     label: "Reports",     icon: BarChart3 },
    { href: `${base}/provider-ggr`, label: "Provider GGR", icon: Percent },
    { href: `${base}/payout-agents`, label: "Payout Agents", icon: Send },
    { href: `${base}/cash-agents`, label: "Cash Agents", icon: HandCoins },
    { href: `${base}/in-person-agents`, label: "In-Person Agents", icon: Store },
    { href: `${base}/payment-methods`, label: "Payment Agents", icon: CreditCard },
    { href: `${base}/rewards`,     label: "Rewards",     icon: Gift },
    { href: `${base}/ads`,         label: "Ads",         icon: Megaphone },
    { href: `${base}/home-promos`, label: "Homepage Promos", icon: LayoutTemplate },
    { href: `${base}/spin`,        label: "Prize Wheel", icon: Disc3 },
    { href: `${base}/sms`,         label: "Unmatched SMS", icon: MessageSquareText },
    { href: `${base}/otp-devices`, label: "OTP Devices", icon: Smartphone },
  ];

  const nav = (
    <nav className="flex flex-col gap-1 p-3 flex-1">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== base && pathname.startsWith(href));
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
        <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">Admin Panel</p>
      </div>
      {nav}
      <div className="p-3 border-t border-[color:var(--border-muted)]">
        <div className="px-3 py-2 mb-1">
          <p className="text-[11px] text-[color:var(--text-muted)]">Logged in as</p>
          <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{adminUser}</p>
        </div>
        <button onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] text-[color:var(--red)] hover:bg-[var(--bg-elevated)] transition-colors">
          <LogOut className="w-4 h-4" /> Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-[var(--bg-base)]">
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-[color:var(--border-muted)] bg-[var(--bg-surface)]">
        {sidebarContent}
      </aside>

      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-12 flex items-center justify-between px-4 bg-[var(--bg-surface)] border-b border-[color:var(--border-muted)]">
        <p className="font-display text-[14px] font-extrabold text-[color:var(--text-primary)]">
          Vinna<span className="text-gold-grad">Bet</span>{" "}
          <span className="text-[color:var(--text-muted)] font-normal text-[12px]">Admin</span>
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

      <main className="flex-1 min-w-0 pt-12 md:pt-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
