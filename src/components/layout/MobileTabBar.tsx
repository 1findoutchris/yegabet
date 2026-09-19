"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Gamepad2, Trophy, Gift, Radio, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthModal } from "@/contexts/AuthModalContext";

interface Tab {
  href: string;
  label: string;
  icon: typeof Trophy;
  match: string;
}

const LEFT: Tab[] = [
  { href: "/sports", label: "Sports", icon: Trophy,   match: "/sports" },
  { href: "/casino", label: "Casino", icon: Gamepad2, match: "/casino" },
];
const RIGHT: Tab[] = [
  { href: "/games",   label: "Games",   icon: Radio, match: "/games"   },
  { href: "/rewards", label: "Rewards", icon: Gift,  match: "/rewards" },
];

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  const Icon = tab.icon;
  return (
    <Link
      href={tab.href}
      className="relative flex flex-col items-center justify-center gap-1 py-2 press"
    >
      {active && (
        <span className="absolute -top-px h-0.5 w-8 rounded-full bg-[var(--gold)] glow-gold" />
      )}
      <Icon
        className="w-5 h-5 transition-colors"
        style={{ color: active ? "var(--gold)" : "var(--text-muted)" }}
      />
      <span
        className="text-[10px] font-medium transition-colors"
        style={{ color: active ? "var(--text-primary)" : "var(--text-muted)" }}
      >
        {tab.label}
      </span>
    </Link>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { openRegister } = useAuthModal();
  const isActive = (m: string) => pathname.startsWith(m);

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-[color:var(--border-muted)] bg-[#0B0710]/90 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5 items-end h-16 px-1">
        {LEFT.map((t) => <TabLink key={t.href} tab={t} active={isActive(t.match)} />)}

        {/* Center raised FAB — Deposit (logged in) or Join (logged out) */}
        <div className="flex justify-center">
          {session ? (
            <Link
              href="/deposit"
              className="press -mt-6 flex flex-col items-center"
              aria-label="Deposit"
            >
              <span className="w-14 h-14 rounded-full bg-gold-grad glow-gold flex items-center justify-center ring-4 ring-[#0B0710]">
                <Wallet className="w-6 h-6 text-[#09090B]" />
              </span>
              <span className="mt-1 text-[10px] font-bold text-[color:var(--gold)]">Deposit</span>
            </Link>
          ) : (
            <button
              onClick={openRegister}
              className="press -mt-6 flex flex-col items-center"
              aria-label="Join now"
            >
              <span className="w-14 h-14 rounded-full bg-gold-grad glow-gold flex items-center justify-center ring-4 ring-[#0B0710] text-[#09090B] text-2xl font-extrabold leading-none">
                +
              </span>
              <span className="mt-1 text-[10px] font-bold text-[color:var(--gold)]">Join</span>
            </button>
          )}
        </div>

        {RIGHT.map((t) => <TabLink key={t.href} tab={t} active={isActive(t.match)} />)}
      </div>
    </nav>
  );
}
