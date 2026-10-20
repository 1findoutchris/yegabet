import { useState } from "react";
import { api, post } from "../lib/api";
import { shortDate } from "../lib/money";
import { Birr, Loading, Notice, Panel, Tag, useAction, useLoad } from "../ui";

const METHOD: Record<string, string> = { telebirr: "Telebirr", cbe_birr: "CBE Birr", ebirr: "eBirr" };

interface QDeposit {
  id: string;
  playerId: string;
  method: string;
  amountSantim: string;
  reference: string;
  status: string;
  createdAt: string;
}

/** Deposits waiting for this agent (the owner sees every agent's). */
export function DepositQueue() {
  const [status, setStatus] = useState("pending");
  const list = useLoad(() => api<QDeposit[]>(`/agent/deposits?status=${status}`), [status]);
  const act = useAction();
  const confirm = (d: QDeposit) =>
    act.run(async () => {
      await post(`/agent/deposits/${d.id}/confirm`);
      list.reload();
    }, "Confirmed. The player's balance went up.");
  const reject = (d: QDeposit) => {
    const reason = window.prompt("Why are you rejecting it? (the player sees this)");
    if (!reason) return;
    return act.run(async () => {
      await post(`/agent/deposits/${d.id}/reject`, { reason });
      list.reload();
    }, "Rejected.");
  };
  return (
    <Panel title="Deposits">
      <p className="muted">
        Check each one against the SMS on your own phone before confirming: confirming adds the money to the
        player&apos;s balance.
      </p>
      <StatusPicker
        value={status}
        onChange={setStatus}
        options={["pending", "confirmed", "rejected", "expired"]}
      />
      <Notice error={act.error} done={act.done} />
      {list.data ? (
        list.data.length === 0 ? (
          <p className="muted">Nothing here.</p>
        ) : (
          <table>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Birr santim={d.amountSantim} /> · {METHOD[d.method] ?? d.method}
                    <div>
                      ref <code>{d.reference}</code>
                    </div>
                    <div className="muted">
                      player #{d.playerId} · {shortDate(d.createdAt)}
                    </div>
                  </td>
                  <td>
                    {d.status === "pending" ? (
                      <div className="row">
                        <button className="small" disabled={act.busy} onClick={() => confirm(d)}>
                          Confirm
                        </button>
                        <button className="small ghost" disabled={act.busy} onClick={() => reject(d)}>
                          Reject
                        </button>
                      </div>
                    ) : (
                      <Tag s={d.status} />
                    )}
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
  );
}

interface QWithdrawal {
  id: string;
  playerId: string;
  method: string;
  amountSantim: string;
  status: string;
  payTo: string | null;
  paidReference: string | null;
  slaDueAt: string;
  createdAt: string;
}

/** Withdrawals to pay (the owner sees every agent's and can complete or cancel). */
export function WithdrawalQueue({ owner = false }: { owner?: boolean }) {
  const [status, setStatus] = useState("requested");
  const list = useLoad(() => api<QWithdrawal[]>(`/agent/withdrawals?status=${status}`), [status]);
  const act = useAction();
  const go = (path: string, body: unknown, message: string) =>
    act.run(async () => {
      await post(path, body);
      list.reload();
    }, message);
  const paid = (w: QWithdrawal) => {
    const reference = window.prompt(`Pay ${w.payTo} first, then enter your payment's reference:`);
    if (reference)
      return go(`/agent/withdrawals/${w.id}/paid`, { reference }, "Marked paid. The player will confirm.");
  };
  const withReason = (w: QWithdrawal, path: string, message: string) => {
    const reason = window.prompt("Reason (the player sees this):");
    if (reason) return go(`/agent/withdrawals/${w.id}/${path}`, { reason }, message);
  };
  return (
    <Panel title="Withdrawals">
      <p className="muted">
        Send the money to the number shown (the player&apos;s verified phone) from your own account, then mark
        it paid with the reference.
      </p>
      <StatusPicker
        value={status}
        onChange={setStatus}
        options={["requested", "escalated", "paid", "disputed", "completed", "declined", "cancelled"]}
      />
      <Notice error={act.error} done={act.done} />
      {list.data ? (
        list.data.length === 0 ? (
          <p className="muted">Nothing here.</p>
        ) : (
          <table>
            <tbody>
              {list.data.map((w) => (
                <tr key={w.id}>
                  <td>
                    <Birr santim={w.amountSantim} /> · {METHOD[w.method] ?? w.method}
                    <div>
                      to <code>{w.payTo}</code>
                    </div>
                    <div className="muted">
                      player #{w.playerId} · due {shortDate(w.slaDueAt)}
                      {w.paidReference && <> · ref {w.paidReference}</>}
                    </div>
                  </td>
                  <td>
                    <div className="row">
                      {(w.status === "requested" || w.status === "escalated") && (
                        <button className="small" disabled={act.busy} onClick={() => paid(w)}>
                          Mark paid
                        </button>
                      )}
                      {w.status === "requested" && !owner && (
                        <button
                          className="small ghost"
                          disabled={act.busy}
                          onClick={() =>
                            withReason(w, "decline", "Declined. The money is back with the player.")
                          }
                        >
                          Decline
                        </button>
                      )}
                      {owner && ["paid", "escalated", "disputed"].includes(w.status) && (
                        <button
                          className="small"
                          disabled={act.busy}
                          onClick={() => go(`/agent/withdrawals/${w.id}/complete`, {}, "Completed.")}
                        >
                          Complete
                        </button>
                      )}
                      {owner && ["requested", "escalated", "disputed"].includes(w.status) && (
                        <button
                          className="small danger"
                          disabled={act.busy}
                          onClick={() =>
                            withReason(w, "cancel", "Cancelled. The money is back with the player.")
                          }
                        >
                          Cancel
                        </button>
                      )}
                      <Tag s={w.status} />
                    </div>
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
  );
}

interface PayAccount {
  id: string;
  method: string;
  accountName: string;
  accountNumber: string;
  active: boolean;
}

export function PaymentAccounts() {
  const list = useLoad(() => api<PayAccount[]>("/agent/payment-accounts"));
  const [method, setMethod] = useState("telebirr");
  const [accountName, setName] = useState("");
  const [accountNumber, setNumber] = useState("");
  const act = useAction();
  const add = () =>
    act.run(async () => {
      await post("/agent/payment-accounts", { method, accountName, accountNumber });
      setName("");
      setNumber("");
      list.reload();
    }, "Added. Your players can pay into it now.");
  const deactivate = (a: PayAccount) =>
    window.confirm(`Stop taking deposits on ${a.accountNumber}?`) &&
    act.run(async () => {
      await post(`/agent/payment-accounts/${a.id}/deactivate`);
      list.reload();
    }, "Deactivated.");
  return (
    <Panel title="Your payment numbers">
      <p className="muted">Players deposit into these. Only add numbers you own.</p>
      {list.data ? (
        <table>
          <tbody>
            {list.data.map((a) => (
              <tr key={a.id}>
                <td>
                  {METHOD[a.method] ?? a.method} · {a.accountNumber}
                  <div className="muted">{a.accountName}</div>
                </td>
                <td>
                  {a.active ? (
                    <button className="small ghost" disabled={act.busy} onClick={() => deactivate(a)}>
                      Deactivate
                    </button>
                  ) : (
                    <Tag s="disabled" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Loading error={list.error} />
      )}
      <h2 style={{ marginTop: 14 }}>Add a number</h2>
      <label>
        <span>Method</span>
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(METHOD).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Account name (as players will see it)</span>
        <input value={accountName} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <span>Number</span>
        <input
          inputMode="tel"
          value={accountNumber}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="0911…"
        />
      </label>
      <button disabled={act.busy} onClick={add}>
        Add
      </button>
      <Notice error={act.error} done={act.done} />
    </Panel>
  );
}

export interface Netting {
  cashPositionSantim: string;
  parentPayableSantim: string;
  netSantim: string;
  instruction: string;
}

export function NettingLine({ n }: { n: Netting }) {
  const abs = n.netSantim.replace("-", "");
  if (n.instruction === "remit_to_company")
    return (
      <p>
        You owe the company{" "}
        <b>
          <Birr santim={abs} />
        </b>
        . Please remit it.
      </p>
    );
  if (n.instruction === "company_pays_agent")
    return (
      <p>
        The company owes you{" "}
        <b>
          <Birr santim={abs} />
        </b>
        .
      </p>
    );
  return <p>You and the company are settled.</p>;
}

interface StatementLine {
  provider: string;
  stakesSantim: string;
  winningsSantim: string;
  resultSantim: string;
  beneficiary: string;
  parentLevel: number | null;
  amountSantim: string;
}

export function Statements() {
  const s = useLoad(() =>
    api<{
      netting: Netting;
      periods: { period: { startsAt: string; endsAt: string }; statements: { lines: StatementLine[] }[] }[];
    }>("/agent/statements"),
  );
  if (!s.data)
    return (
      <Panel title="Statements">
        <Loading error={s.error} />
      </Panel>
    );
  return (
    <>
      <Panel title="Balance with the company">
        <NettingLine n={s.data.netting} />
      </Panel>
      {s.data.periods.length === 0 && (
        <Panel>
          <p className="muted">No approved statements yet.</p>
        </Panel>
      )}
      {s.data.periods.map((p) => (
        <Panel
          key={p.period.startsAt}
          title={`${shortDate(p.period.startsAt)} – ${shortDate(p.period.endsAt)}`}
        >
          <LinesTable lines={p.statements[0]?.lines ?? []} />
        </Panel>
      ))}
    </>
  );
}

export function LinesTable({ lines }: { lines: StatementLine[] }) {
  const first = lines[0];
  if (!first) return <p className="muted">No activity.</p>;
  return (
    <>
      <p className="muted">
        Stakes <Birr santim={first.stakesSantim} /> − winnings <Birr santim={first.winningsSantim} /> = result{" "}
        <b>
          <Birr santim={first.resultSantim} />
        </b>
      </p>
      <table>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.beneficiary === "parent" ? `Parent ${l.parentLevel}` : l.beneficiary}
                <span className="muted"> · {l.provider}</span>
              </td>
              <td>
                <Birr santim={l.amountSantim} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function StatusPicker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange(v: string): void;
  options: string[];
}) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <a
          key={o}
          href={window.location.hash}
          className={value === o ? "on" : ""}
          onClick={(e) => (e.preventDefault(), onChange(o))}
        >
          {o}
        </a>
      ))}
    </div>
  );
}
