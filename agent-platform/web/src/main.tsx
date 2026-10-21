import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lobby.css";
import "./styles.css";
import {
  AgentsAdmin,
  OwnerMoneyNote,
  RulesAdmin,
  SettlementAdmin,
  StaffAdmin,
  Switches,
} from "./pages/admin";
import { DepositQueue, PaymentAccounts, Statements, WithdrawalQueue } from "./pages/agent";
import { CategoryPage, GamesPage, LobbyPage, ProviderPage, SearchPage } from "./pages/lobby";
import { AccountPage, DepositPage, WithdrawPage } from "./pages/player";
import { post } from "./lib/api";
import { openUrl } from "./lib/telegram";
import { Brand, Login, SessionProvider, useSession, type Principal } from "./session";
import { Panel, Tabs, useAction, useRoute } from "./ui";
import { AppHeader, BottomNav, Footer } from "./vinna/chrome";
import { PlayProvider, type Game } from "./vinna/games";

function Header({ role }: { role: string }) {
  const { me, logout } = useSession();
  return (
    <header className="top">
      <Brand role={role} />
      {me && me.kind !== "player" && (
        <button className="small ghost" onClick={logout}>
          Log out
        </button>
      )}
    </header>
  );
}

/** The player site in the old YegaBet design: anyone can browse; playing and money need a login. */
function LobbyApp() {
  const route = useRoute();
  const { me } = useSession();
  const launch = useAction();
  const play = (g: Game) => {
    if (!me) {
      window.location.hash = "/login";
      return;
    }
    launch.run(async () => {
      if (me.kind !== "player") throw new Error("Log in as a player to play games.");
      const { url } = await post<{ url: string }>(`/games/${encodeURIComponent(g.gameUid)}/launch`, {
        device: window.innerWidth < 800 ? "mobile" : "desktop",
      });
      openUrl(url);
    });
  };
  const [, section, arg] = route.split("/");
  const money: Record<string, JSX.Element> = {
    deposit: <DepositPage />,
    withdraw: <WithdrawPage />,
    account: <AccountPage />,
  };
  const page =
    section === "login" || (section && money[section] && me?.kind !== "player") ? (
      me ? (
        <div className="app">
          <Panel>
            You are logged in as {me.kind === "staff" ? "staff" : "an agent"}. Wallets are for players.
          </Panel>
        </div>
      ) : (
        <Login embedded />
      )
    ) : section && money[section] ? (
      <div className="app">{money[section]}</div>
    ) : section === "c" && arg ? (
      <CategoryPage category={arg} />
    ) : section === "games" ? (
      <GamesPage category={arg} />
    ) : section === "p" && arg ? (
      <ProviderPage slug={arg} />
    ) : section === "search" ? (
      <SearchPage />
    ) : (
      <LobbyPage />
    );
  return (
    <PlayProvider play={play}>
      <AppHeader route={route} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-[72px] pb-24 md:pb-12 min-h-screen">
        {(launch.error || launch.busy) && (
          <div className="mb-4 rounded-[14px] px-4 py-3 text-[13px] bg-[var(--v-bg-2)] border border-[color:var(--v-line-2)] text-white">
            {launch.busy ? "Opening the game…" : launch.error}
          </div>
        )}
        {page}
      </main>
      <Footer />
      <BottomNav route={route} />
    </PlayProvider>
  );
}

function AgentApp() {
  const route = useRoute();
  const items: [string, string][] = [
    ["/agent/deposits", "Deposits"],
    ["/agent/withdrawals", "Withdrawals"],
    ["/agent/accounts", "Payment numbers"],
    ["/agent/statements", "Statements"],
  ];
  const page =
    route === "/agent/withdrawals" ? (
      <WithdrawalQueue />
    ) : route === "/agent/accounts" ? (
      <PaymentAccounts />
    ) : route === "/agent/statements" ? (
      <Statements />
    ) : (
      <DepositQueue />
    );
  return (
    <div className="app">
      <Header role="agent" />
      <Tabs items={items} route={route === "/agent" ? "/agent/deposits" : route} />
      {page}
    </div>
  );
}

function StaffApp({ me }: { me: Extract<Principal, { kind: "staff" }> }) {
  const route = useRoute();
  const owner = me.roles.includes("owner");
  const items: [string, string][] = [
    ["/admin/agents", "Agents"],
    ...(owner
      ? ([
          ["/admin/switches", "Switches"],
          ["/admin/deposits", "Deposits"],
          ["/admin/withdrawals", "Withdrawals"],
          ["/admin/settlement", "Settlement"],
          ["/admin/rules", "Rules"],
          ["/admin/staff", "Staff"],
        ] as [string, string][])
      : []),
  ];
  const pages: Record<string, JSX.Element> = {
    "/admin/switches": <Switches />,
    "/admin/deposits": (
      <>
        <OwnerMoneyNote />
        <DepositQueue />
      </>
    ),
    "/admin/withdrawals": (
      <>
        <OwnerMoneyNote />
        <WithdrawalQueue owner />
      </>
    ),
    "/admin/settlement": <SettlementAdmin />,
    "/admin/rules": <RulesAdmin />,
    "/admin/staff": <StaffAdmin />,
  };
  return (
    <div className="app">
      <Header role={owner ? "owner" : "staff"} />
      <Tabs items={items} route={route === "/admin" ? "/admin/agents" : route} />
      {(owner && pages[route]) || <AgentsAdmin />}
    </div>
  );
}

/** One app: the lobby for everyone, plus the agent desk (#/agent) and back office (#/admin) for their roles. */
function App() {
  const { me } = useSession();
  const route = useRoute();
  const desk = route.startsWith("/agent") ? "agent_member" : route.startsWith("/admin") ? "staff" : null;
  if (!desk) return <LobbyApp />;
  if (!me) return <Login />;
  if (desk === "agent_member" && me.kind === "agent_member") return <AgentApp />;
  if (desk === "staff" && me.kind === "staff") return <StaffApp me={me} />;
  return <LobbyApp />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <SessionProvider>{() => <App />}</SessionProvider>
  </StrictMode>,
);
