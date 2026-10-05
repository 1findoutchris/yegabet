import { AuthModalProvider } from "@/contexts/AuthModalContext";
import { AuthModal } from "@/components/auth/AuthModal";
import { FavoritesProvider } from "@/contexts/FavoritesContext";
import { GamePlayerProvider } from "@/contexts/GamePlayerContext";
import { GamePlayer } from "@/components/casino/GamePlayer";
import { CelebrationProvider } from "@/contexts/CelebrationContext";
import { BalanceProvider } from "@/contexts/BalanceContext";
import { EngagementWatcher } from "@/components/retention/EngagementWatcher";
import { SpinPrompt } from "@/components/retention/SpinPrompt";
import { CasinoNav } from "@/components/casino/CasinoNav";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { TelegramChannel } from "@/components/layout/TelegramChannel";
import { InstallBanner } from "@/components/layout/InstallBanner";
import { SportsPane } from "@/components/sports/SportsPane";
import { AgentShell } from "@/components/agent/AgentShell";
import { auth } from "@/lib/auth";

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAgent = session?.user?.role === "IN_PERSON_AGENT";

  // In-person betting agents get the cashier shell instead of the casino
  // chrome — same providers, same mounted SportsPane, different nav. The
  // shell's client-side guard bounces them off any non-agent route.
  if (isAgent) {
    return (
      <AuthModalProvider>
        <BalanceProvider>
          <AgentShell>{children}</AgentShell>
          {/* SportsPane stays mounted at all times so the iframe never reloads */}
          <SportsPane agentMode />
          <AuthModal />
        </BalanceProvider>
      </AuthModalProvider>
    );
  }

  return (
    <AuthModalProvider>
      <FavoritesProvider>
      <GamePlayerProvider>
        <CelebrationProvider>
        <BalanceProvider>
          <CasinoNav />
          {/* pt-14 offsets the fixed navbar; bottom padding clears the mobile tab bar */}
          <div className="pt-14 min-h-screen pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
            <InstallBanner />
            {children}
          </div>
          {/* SportsPane stays mounted at all times so the iframe never reloads */}
          <SportsPane />
          <MobileTabBar />
          <TelegramChannel />
          <AuthModal />
          <GamePlayer />
          <EngagementWatcher />
          <SpinPrompt />
        </BalanceProvider>
        </CelebrationProvider>
      </GamePlayerProvider>
      </FavoritesProvider>
    </AuthModalProvider>
  );
}
