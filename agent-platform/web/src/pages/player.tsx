import { useState } from "react";
import { api, post } from "../lib/api";
import { isAmount, shortDate } from "../lib/money";
import { miniApp, openUrl } from "../lib/telegram";
import { useSession } from "../session";
import { Birr, Loading, Notice, Panel, Tag, useAction, useLoad } from "../ui";

interface Wallet {
  availableSantim: string;
  heldSantim: string;
}
interface Game {
  gameUid: string;
  name: string;
  type: string | null;
  img: string | null;
  providerName: string | null;
}

export function PlayerHome() {
  const wallet = useLoad(() => api<Wallet>("/me/wallet"));
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const games = useLoad(
    () =>
      api<{ games: Game[]; total: number }>(
        `/games?search=${encodeURIComponent(search)}&type=${encodeURIComponent(type)}`,
      ),
    [search, type],
  );
  const play = useAction();
  const launch = (g: Game) =>
    play.run(async () => {
      const { url } = await post<{ url: string }>(`/games/${encodeURIComponent(g.gameUid)}/launch`, {
        device: window.innerWidth < 800 ? "mobile" : "desktop",
      });
      openUrl(url);
    });

  return (
    <>
      <Panel>
        <div className="muted">Balance</div>
        {wallet.data ? (
          <>
            <div className="big">
              <Birr santim={wallet.data.availableSantim} />
            </div>
            {wallet.data.heldSantim !== "0" && (
              <div className="muted">
                <Birr santim={wallet.data.heldSantim} /> held for withdrawals
              </div>
            )}
          </>
        ) : (
          <Loading error={wallet.error} />
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <a href="#/deposit">
            <button>Deposit</button>
          </a>
          <a href="#/withdraw">
            <button className="ghost">Withdraw</button>
          </a>
        </div>
      </Panel>
      <Panel title="Games">
        <div className="row" style={{ marginBottom: 10 }}>
          <input
            placeholder="Search games"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 2 }}
          />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ flex: 1 }}>
            <option value="">All</option>
            {["Slot", "Crash", "Live", "Table", "Instant", "Arcade", "Multiplayer"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <Notice error={play.error} />
        {games.data ? (
          games.data.games.length === 0 ? (
            <p className="muted">No games yet.</p>
          ) : (
            <div className="games">
              {games.data.games.map((g) => (
                <div key={g.gameUid} className="game" onClick={() => launch(g)}>
                  {g.img ? <img src={g.img} alt="" loading="lazy" /> : <img alt="" />}
                  <div>
                    {g.name}
                    <div className="muted">{g.providerName}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <Loading error={games.error} />
        )}
      </Panel>
    </>
  );
}

interface PayAccount {
  id: string;
  method: string;
  accountName: string;
  accountNumber: string;
}
interface Deposit {
  id: string;
  method: string;
  amountSantim: string;
  reference: string;
  status: string;
  decisionReason: string | null;
  createdAt: string;
}

const METHOD: Record<string, string> = { telebirr: "Telebirr", cbe_birr: "CBE Birr", ebirr: "eBirr" };

export function DepositPage() {
  const accounts = useLoad(() => api<PayAccount[]>("/deposits/accounts"));
  const list = useLoad(() => api<Deposit[]>("/deposits"));
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const send = useAction();
  const chosen = accounts.data?.find((a) => a.id === accountId);

  const submit = () =>
    send.run(async () => {
      if (!chosen) throw new Error("Choose where you paid.");
      if (!isAmount(amount)) throw new Error("Enter the amount in birr, e.g. 500 or 500.50.");
      await post("/deposits", { paymentAccountId: chosen.id, amount, reference });
      setAmount("");
      setReference("");
      list.reload();
    }, "Sent. Your agent will confirm it after checking their phone.");

  return (
    <>
      <Panel title="Deposit">
        <p className="muted">
          1. Send money to one of your agent&apos;s numbers below. 2. Enter the amount and the reference from
          your payment SMS.
        </p>
        {accounts.data ? (
          accounts.data.length === 0 ? (
            <p className="muted">Your agent hasn&apos;t added a payment number yet.</p>
          ) : (
            <>
              <label>
                <span>Where did you pay?</span>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Choose…</option>
                  {accounts.data.map((a) => (
                    <option key={a.id} value={a.id}>
                      {METHOD[a.method] ?? a.method} · {a.accountNumber} · {a.accountName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Amount (ETB)</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="500"
                />
              </label>
              <label>
                <span>Transaction reference (from the SMS)</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. CHK12345678"
                />
              </label>
              <button disabled={send.busy} onClick={submit}>
                {send.busy ? "Sending…" : "I have paid"}
              </button>
            </>
          )
        ) : (
          <Loading error={accounts.error} />
        )}
        <Notice error={send.error} done={send.done} />
      </Panel>
      <Panel title="Your deposits">
        {list.data ? <DepositTable rows={list.data} /> : <Loading error={list.error} />}
      </Panel>
    </>
  );
}

function DepositTable({ rows }: { rows: Deposit[] }) {
  if (rows.length === 0) return <p className="muted">None yet.</p>;
  return (
    <table>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id}>
            <td>
              <Birr santim={d.amountSantim} />
              <div className="muted">
                {METHOD[d.method] ?? d.method} · {d.reference} · {shortDate(d.createdAt)}
              </div>
              {d.decisionReason && <div className="muted">{d.decisionReason}</div>}
            </td>
            <td>
              <Tag s={d.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Withdrawal {
  id: string;
  method: string;
  amountSantim: string;
  status: string;
  paidReference: string | null;
  destination: string | null;
  closeReason: string | null;
  createdAt: string;
}

export function WithdrawPage() {
  const wallet = useLoad(() => api<Wallet>("/me/wallet"));
  const list = useLoad(() => api<Withdrawal[]>("/withdrawals"));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("telebirr");
  const send = useAction();
  const act = useAction();
  const refresh = () => {
    list.reload();
    wallet.reload();
  };

  const submit = () =>
    send.run(async () => {
      if (!isAmount(amount)) throw new Error("Enter the amount in birr, e.g. 500.");
      await post("/withdrawals", { amount, method });
      setAmount("");
      refresh();
    }, "Requested. Your agent will send it to your phone number.");
  const step = (w: Withdrawal, path: string, message: string) =>
    act.run(async () => {
      await post(`/withdrawals/${w.id}/${path}`);
      refresh();
    }, message);
  const destination = list.data?.[0]?.destination;

  return (
    <>
      <Panel title="Withdraw">
        <div className="muted">
          Available: {wallet.data ? <Birr santim={wallet.data.availableSantim} /> : "…"}
          {destination && <> · paid to your number {destination}</>}
        </div>
        <label>
          <span>Amount (ETB)</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="200"
          />
        </label>
        <label>
          <span>Receive on</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(METHOD).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button disabled={send.busy} onClick={submit}>
          {send.busy ? "Sending…" : "Request withdrawal"}
        </button>
        <Notice error={send.error} done={send.done} />
      </Panel>
      <Panel title="Your withdrawals">
        <Notice error={act.error} done={act.done} />
        {list.data ? (
          list.data.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <table>
              <tbody>
                {list.data.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <Birr santim={w.amountSantim} />
                      <div className="muted">
                        {METHOD[w.method] ?? w.method} · {shortDate(w.createdAt)}
                        {w.paidReference && <> · ref {w.paidReference}</>}
                      </div>
                      {w.status === "paid" && (
                        <div className="row" style={{ marginTop: 6 }}>
                          <button
                            className="small"
                            disabled={act.busy}
                            onClick={() => step(w, "received", "Thanks, confirmed.")}
                          >
                            I received it
                          </button>
                          <button
                            className="small ghost"
                            disabled={act.busy}
                            onClick={() => step(w, "not-received", "Reported. Support will check it.")}
                          >
                            Not received
                          </button>
                        </div>
                      )}
                      {w.status === "requested" && (
                        <button
                          className="small ghost"
                          style={{ marginTop: 6 }}
                          disabled={act.busy}
                          onClick={() => step(w, "cancel", "Cancelled. The money is back in your balance.")}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                    <td>
                      <Tag s={w.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <Loading error={list.error} />
        )}
      </Panel>
    </>
  );
}

export function AccountPage() {
  const { me, logout, info } = useSession();
  return (
    <Panel title="Account">
      <p className="muted">Logged in as a player (#{me && "playerId" in me ? me.playerId : "?"}).</p>
      {!miniApp() && (
        <button className="ghost" onClick={logout}>
          Log out
        </button>
      )}
      <p className="muted" style={{ marginTop: 16 }}>
        Need help? Message <a href={`https://t.me/${info.botUsername ?? ""}`}>@{info.botUsername}</a>.
      </p>
    </Panel>
  );
}
