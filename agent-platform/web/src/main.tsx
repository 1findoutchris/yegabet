import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
import { AccountPage, DepositPage, PlayerHome, WithdrawPage } from "./pages/player";
import { Login, SessionProvider, useSession, type Principal } from "./session";
import { Panel, Tabs, useRoute } from "./ui";

function Header({ role }: { role: string }) {
  const { info, me, logout } = useSession();
  return (
    <header className="top">
      <div className="logo">
        <b>{info.name.slice(0, 4)}</b>
        {info.name.slice(4)} <span className="muted">{role}</span>
      </div>
      {me && me.kind !== "player" && (
        <button className="small ghost" onClick={logout}>
          Log out
        </button>
      )}
    </header>
  );
}

function PlayerApp() {
  const route = useRoute();
  const page =
    route === "/deposit" ? (
      <DepositPage />
    ) : route === "/withdraw" ? (
      <WithdrawPage />
    ) : route === "/account" ? (
      <AccountPage />
    ) : (
      <PlayerHome />
    );
  const nav: [string, string][] = [
    ["/", "Play"],
    ["/deposit", "Deposit"],
    ["/withdraw", "Withdraw"],
    ["/account", "Account"],
  ];
  return (
    <div className="app">
      <Header role="" />
      {page}
      <nav className="bottom">
        {nav.map(([href, label]) => (
          <a key={href} href={`#${href}`} className={route === href ? "on" : ""}>
            {label}
          </a>
        ))}
      </nav>
    </div>
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

/** One app, three roles: the logged-in principal decides which screens show. */
function App() {
  const { me } = useSession();
  if (!me) return <Login />;
  if (me.kind === "player") return <PlayerApp />;
  if (me.kind === "agent_member") return <AgentApp />;
  if (me.kind === "staff") return <StaffApp me={me} />;
  return (
    <div className="app">
      <Panel>Unknown account.</Panel>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <SessionProvider>{() => <App />}</SessionProvider>
  </StrictMode>,
);
