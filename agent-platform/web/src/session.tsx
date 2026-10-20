import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, post, setBearer } from "./lib/api";
import { miniApp, openUrl } from "./lib/telegram";
import { Notice, Panel, useAction } from "./ui";

export type Principal =
  | { kind: "player"; playerId: string }
  | { kind: "agent_member"; memberId: string; agentId: string }
  | { kind: "staff"; staffId: string; roles: string[] };

export interface Info {
  name: string;
  domain: string;
  botUsername: string | null;
  webappUrl: string | null;
}

interface Session {
  me: Principal | null;
  info: Info;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => useContext(Ctx) as Session;

/**
 * Who is logged in. Inside Telegram the Mini App logs the player in by itself
 * (initData, checked by the server). On the web the session cookie decides.
 */
export function SessionProvider({ children }: { children: (s: Session) => ReactNode }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [me, setMe] = useState<Principal | null | undefined>(undefined);

  const refresh = async () => {
    try {
      setMe(await api<Principal>("/me"));
    } catch {
      setMe(null);
    }
  };

  useEffect(() => {
    void (async () => {
      setInfo(await api<Info>("/public/info"));
      const app = miniApp();
      if (app) {
        app.ready();
        app.expand();
        try {
          const r = await post<{ token: string; principal: Principal }>("/auth/telegram/miniapp", {
            initData: app.initData,
            as: "player",
          });
          setBearer(r.token);
          setMe(r.principal);
          return;
        } catch {
          // No player account yet: show the sign-up screen.
        }
      }
      await refresh();
    })();
  }, []);

  if (!info || me === undefined)
    return (
      <p className="muted center" style={{ padding: 40 }}>
        Loading…
      </p>
    );
  const session: Session = {
    me,
    info,
    refresh,
    logout: async () => {
      await post("/auth/logout").catch(() => undefined);
      setBearer(null);
      setMe(null);
      window.location.hash = "/";
    },
  };
  return <Ctx.Provider value={session}>{children(session)}</Ctx.Provider>;
}

/** Login (Telegram Login Widget, as player / agent / staff) and sign-up (hand-off to the bot). */
export function Login() {
  const { info, refresh } = useSession();
  const [as, setAs] = useState<"player" | "agent_member" | "staff">(() =>
    window.location.hash.startsWith("#/admin")
      ? "staff"
      : window.location.hash.startsWith("#/agent")
        ? "agent_member"
        : "player",
  );
  const widget = useRef<HTMLDivElement>(null);
  const login = useAction();
  const signup = useAction();
  const [waiting, setWaiting] = useState(false);

  // The official widget: Telegram confirms the user, our server checks the signature.
  useEffect(() => {
    if (!info.botUsername || !widget.current) return;
    (window as unknown as { onTelegramAuth: (u: Record<string, unknown>) => void }).onTelegramAuth = (user) =>
      void login.run(async () => {
        await post("/auth/telegram/widget", { ...user, as });
        await refresh();
      });
    widget.current.innerHTML = "";
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", info.botUsername);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    widget.current.appendChild(s);
  }, [info.botUsername, as]);

  /** Website sign-up: a one-time code carries the agent's referral into the bot, then we wait for it. */
  const startSignup = () =>
    signup.run(async () => {
      const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
      const r = await post<{ code: string; botLink: string }>("/auth/signup/start", { ref });
      openUrl(r.botLink);
      setWaiting(true);
      for (let i = 0; i < 300; i++) {
        await new Promise((ok) => setTimeout(ok, 3000));
        const s = await api<{ status: string }>(`/auth/signup/status?code=${encodeURIComponent(r.code)}`);
        if (s.status === "done") {
          setWaiting(false);
          await refresh();
          return;
        }
      }
      setWaiting(false);
      throw new Error("The sign-up link expired. Please try again.");
    });

  const inTelegram = miniApp() !== null;
  return (
    <div className="app">
      <header className="top">
        <div className="logo">
          <b>{info.name.slice(0, 4)}</b>
          {info.name.slice(4)}
        </div>
      </header>
      {as === "player" && (
        <Panel title="Create your account">
          <p className="muted">
            Sign-up happens in Telegram: you confirm you are 18 or older and share your phone number. It takes
            a minute.
          </p>
          {inTelegram && info.botUsername ? (
            <button onClick={() => openUrl(`https://t.me/${info.botUsername}`)}>Sign up in the bot</button>
          ) : (
            <button disabled={signup.busy} onClick={startSignup}>
              {waiting ? "Waiting for Telegram…" : "Sign up with Telegram"}
            </button>
          )}
          <Notice error={signup.error} />
        </Panel>
      )}
      {!inTelegram && (
        <Panel title="Log in">
          <div className="tabs">
            {(
              [
                ["player", "Player"],
                ["agent_member", "Agent"],
                ["staff", "Staff"],
              ] as const
            ).map(([k, label]) => (
              <a
                key={k}
                href={window.location.hash || "#/"}
                className={as === k ? "on" : ""}
                onClick={(e) => (e.preventDefault(), setAs(k))}
              >
                {label}
              </a>
            ))}
          </div>
          {info.botUsername ? (
            <div ref={widget} />
          ) : (
            <p className="muted">Telegram login isn&apos;t configured yet.</p>
          )}
          <Notice error={login.error} />
        </Panel>
      )}
    </div>
  );
}
