import { useState } from "react";
import { api, post } from "../lib/api";
import { shortDate } from "../lib/money";
import { CopyButton, Loading, Notice, Panel, Tag, useAction, useLoad } from "../ui";
import { LinesTable, NettingLine, type Netting } from "./agent";

interface AgentRow {
  id: string;
  slug: string;
  displayName: string;
  parentId: string | null;
  parentSlug: string | null;
  depth: number;
  isCompany: boolean;
  status: string;
  players: number;
  members: number;
  links: { telegram: string | null; website: string };
}

export function AgentsAdmin() {
  const [search, setSearch] = useState("");
  const list = useLoad(() => api<AgentRow[]>(`/admin/agents?search=${encodeURIComponent(search)}`), [search]);
  const [slug, setSlug] = useState("");
  const [displayName, setName] = useState("");
  const [parentId, setParent] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const act = useAction();

  const create = () =>
    act.run(async () => {
      await post("/admin/agents", { slug, displayName, parentId: parentId || undefined });
      setSlug("");
      setName("");
      setParent("");
      list.reload();
    }, "Agent created. Copy their referral link below.");
  const status = (a: AgentRow, s: string) =>
    window.confirm(`Set ${a.slug} to ${s}?`) &&
    act.run(async () => {
      await post(`/admin/agents/${a.id}/status`, { status: s });
      list.reload();
    }, `${a.slug} is now ${s}.`);

  return (
    <>
      <Panel title="New agent">
        <label>
          <span>Short name for links (a–z, 0–9, -)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="abebe-shop"
          />
        </label>
        <label>
          <span>Display name</span>
          <input value={displayName} onChange={(e) => setName(e.target.value)} placeholder="Abebe's shop" />
        </label>
        <label>
          <span>Parent agent (can never be changed later)</span>
          <select value={parentId} onChange={(e) => setParent(e.target.value)}>
            <option value="">None (top level)</option>
            {list.data
              ?.filter((a) => !a.isCompany && a.status === "active")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.slug}
                </option>
              ))}
          </select>
        </label>
        <button disabled={act.busy} onClick={create}>
          Create agent
        </button>
        <Notice error={act.error} done={act.done} />
      </Panel>
      <Panel title="Agents">
        <input
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        {list.data ? (
          <table>
            <tbody>
              {list.data.map((a) => (
                <tr key={a.id}>
                  <td>
                    <b>{a.displayName}</b> <span className="muted">{a.slug}</span>
                    <div className="muted">
                      {a.isCompany
                        ? "company (direct players)"
                        : a.parentSlug
                          ? `under ${a.parentSlug}`
                          : "top level"}{" "}
                      · {a.players} players · {a.members} members
                    </div>
                    {!a.isCompany && (
                      <div className="row" style={{ marginTop: 4 }}>
                        {a.links.telegram && (
                          <CopyButton label="Copy Telegram link" text={a.links.telegram} />
                        )}
                        <CopyButton label="Copy website link" text={a.links.website} />
                        <button className="small ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>
                          Members
                        </button>
                      </div>
                    )}
                    {!a.isCompany && (
                      <div className="muted" style={{ marginTop: 4 }}>
                        {a.links.telegram && (
                          <div>
                            <code>{a.links.telegram}</code>
                          </div>
                        )}
                        <div>
                          <code>{a.links.website}</code>
                        </div>
                      </div>
                    )}
                    {open === a.id && <Members agentId={a.id} />}
                  </td>
                  <td>
                    <Tag s={a.status} />
                    {!a.isCompany && (
                      <div style={{ marginTop: 6 }}>
                        <select value="" onChange={(e) => e.target.value && status(a, e.target.value)}>
                          <option value="">Change…</option>
                          {["active", "paused", "closed"]
                            .filter((s) => s !== a.status)
                            .map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                        </select>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Loading error={list.error} />
        )}
      </Panel>
    </>
  );
}

interface Member {
  id: string;
  displayName: string;
  telegramUserId: string | null;
  status: string;
}

function Members({ agentId }: { agentId: string }) {
  const list = useLoad(() => api<Member[]>(`/admin/agents/${agentId}/members`), [agentId]);
  const [telegramUserId, setTg] = useState("");
  const [displayName, setName] = useState("");
  const act = useAction();
  const add = () =>
    act.run(async () => {
      await post(`/admin/agents/${agentId}/members`, { telegramUserId, displayName });
      setTg("");
      setName("");
      list.reload();
    }, 'Added. They log in as "Agent" with that Telegram account.');
  const toggle = (m: Member) =>
    act.run(async () => {
      await post(`/admin/members/${m.id}/status`, { status: m.status === "active" ? "disabled" : "active" });
      list.reload();
    });
  return (
    <div className="panel" style={{ marginTop: 8 }}>
      {list.data?.map((m) => (
        <div key={m.id} className="row spread">
          <span>
            {m.displayName} <span className="muted">tg {m.telegramUserId}</span> <Tag s={m.status} />
          </span>
          <button className="small ghost" disabled={act.busy} onClick={() => toggle(m)}>
            {m.status === "active" ? "Disable" : "Enable"}
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <input
          placeholder="Telegram user id"
          value={telegramUserId}
          onChange={(e) => setTg(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          placeholder="Name"
          value={displayName}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="small" disabled={act.busy} onClick={add}>
          Add member
        </button>
      </div>
      <Notice error={act.error} done={act.done} />
    </div>
  );
}

const FLAG_LABEL: Record<string, string> = {
  "signup.open": "Sign-ups",
  "deposits.open": "Deposits",
  "withdrawals.open": "Withdrawals",
  "games.open": "Games",
};

export function Switches() {
  const flags = useLoad(() => api<Record<string, boolean>>("/admin/flags"));
  const act = useAction();
  const set = (key: string, enabled: boolean) =>
    window.confirm(`Turn ${FLAG_LABEL[key] ?? key} ${enabled ? "ON" : "OFF"} for everyone?`) &&
    act.run(async () => {
      await post("/admin/flags", { key, enabled });
      flags.reload();
    });
  return (
    <Panel title="Launch switches">
      <p className="muted">
        Everything is off until you turn it on. Turning one off stops it at once for everyone.
      </p>
      {flags.data ? (
        Object.entries(flags.data).map(([k, on]) => (
          <div key={k} className="row spread" style={{ padding: "8px 0" }}>
            <span>
              {FLAG_LABEL[k] ?? k} <Tag s={on ? "active" : "closed"} />
            </span>
            <button className={on ? "small danger" : "small"} disabled={act.busy} onClick={() => set(k, !on)}>
              {on ? "Turn off" : "Turn on"}
            </button>
          </div>
        ))
      ) : (
        <Loading error={flags.error} />
      )}
      <Notice error={act.error} />
    </Panel>
  );
}

interface Period {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
}
interface Statement {
  agentId: string;
  lines: Parameters<typeof LinesTable>[0]["lines"];
  netting: Netting;
}

export function SettlementAdmin() {
  const periods = useLoad(() => api<Period[]>("/admin/settlement/periods"));
  const [open, setOpen] = useState<string | null>(null);
  const statements = useLoad(
    () =>
      open
        ? api<{ statements: Statement[] }>(`/admin/settlement/periods/${open}/statements`)
        : Promise.resolve(null),
    [open],
  );
  const act = useAction();
  const go = (p: Period, what: "draft" | "approve") =>
    (what === "draft" ||
      window.confirm("Approve this period? Shares are posted and the statements are frozen.")) &&
    act.run(
      async () => {
        await post(`/admin/settlement/periods/${p.id}/${what}`);
        periods.reload();
        setOpen(p.id);
        statements.reload();
      },
      what === "draft" ? "Draft recomputed." : "Approved and posted.",
    );
  return (
    <>
      <Panel title="Settlement periods">
        <Notice error={act.error} done={act.done} />
        {periods.data ? (
          periods.data.length === 0 ? (
            <p className="muted">
              No periods yet. Set the launch date in Rules (settlement.first_period_start).
            </p>
          ) : (
            <table>
              <tbody>
                {periods.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {shortDate(p.startsAt)} – {shortDate(p.endsAt)} <Tag s={p.status} />
                    </td>
                    <td>
                      <div className="row">
                        <button className="small ghost" onClick={() => setOpen(p.id)}>
                          View
                        </button>
                        {p.status !== "approved" && new Date(p.endsAt) <= new Date() && (
                          <button className="small ghost" disabled={act.busy} onClick={() => go(p, "draft")}>
                            Draft
                          </button>
                        )}
                        {p.status === "draft" && (
                          <button className="small" disabled={act.busy} onClick={() => go(p, "approve")}>
                            Approve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <Loading error={periods.error} />
        )}
      </Panel>
      {open &&
        (statements.data ? (
          statements.data.statements.length === 0 ? (
            <Panel>
              <p className="muted">No statement lines for this period.</p>
            </Panel>
          ) : (
            statements.data.statements.map((s) => (
              <Panel key={s.agentId} title={`Agent #${s.agentId}`}>
                <LinesTable lines={s.lines} />
                <NettingLine n={s.netting} />
              </Panel>
            ))
          )
        ) : (
          <Panel>
            <Loading error={statements.error} />
          </Panel>
        ))}
    </>
  );
}

export function RulesAdmin() {
  const cfg = useLoad(() =>
    api<Record<string, { value: unknown; effectiveFrom: string } | null>>("/admin/config"),
  );
  const [key, setKey] = useState("commission.split");
  const [value, setValue] = useState("");
  const [effectiveFrom, setFrom] = useState("");
  const act = useAction();
  const save = () =>
    window.confirm(
      `Save a new version of ${key}? It applies from ${effectiveFrom || "now"} and never changes approved periods.`,
    ) &&
    act.run(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error('The value must be JSON, e.g. 10, "2026-10-21T00:00:00+03:00" or {"agentBp":6000,…}');
      }
      await post("/admin/config", {
        key,
        value: parsed,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
      });
      cfg.reload();
    }, "Saved.");
  return (
    <>
      <Panel title="Rules in force now">
        <p className="muted">Shares are in basis points: 6000 = 60%.</p>
        {cfg.data ? (
          <table>
            <tbody>
              {Object.entries(cfg.data).map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <b>{k}</b>
                    <div className="muted">{v ? `since ${shortDate(v.effectiveFrom)}` : "not set"}</div>
                  </td>
                  <td>
                    <code>{v ? JSON.stringify(v.value) : "—"}</code>{" "}
                    <button
                      className="small ghost"
                      onClick={() => (setKey(k), setValue(v ? JSON.stringify(v.value) : ""))}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Loading error={cfg.error} />
        )}
      </Panel>
      <Panel title="Change a rule">
        <label>
          <span>Rule</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <label>
          <span>New value (JSON)</span>
          <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label>
          <span>Applies from (empty = now)</span>
          <input type="datetime-local" value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <button disabled={act.busy} onClick={save}>
          Save new version
        </button>
        <Notice error={act.error} done={act.done} />
      </Panel>
    </>
  );
}

interface StaffRow {
  id: string;
  displayName: string;
  telegramUserId: string | null;
  status: string;
  roles: string[];
}

export function StaffAdmin() {
  const list = useLoad(() => api<StaffRow[]>("/admin/staff"));
  const [telegramUserId, setTg] = useState("");
  const [displayName, setName] = useState("");
  const [role, setRole] = useState("support");
  const act = useAction();
  const add = () =>
    act.run(async () => {
      await post("/admin/staff", { telegramUserId, displayName, role });
      list.reload();
    }, 'Saved. They log in as "Staff".');
  const toggle = (s: StaffRow) =>
    act.run(async () => {
      await post(`/admin/staff/${s.id}/status`, { status: s.status === "active" ? "disabled" : "active" });
      list.reload();
    });
  return (
    <Panel title="Staff">
      {list.data ? (
        <table>
          <tbody>
            {list.data.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.displayName} <span className="muted">tg {s.telegramUserId}</span>
                  <div className="muted">{s.roles.join(", ")}</div>
                </td>
                <td>
                  <Tag s={s.status} />{" "}
                  <button className="small ghost" disabled={act.busy} onClick={() => toggle(s)}>
                    {s.status === "active" ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Loading error={list.error} />
      )}
      <h2 style={{ marginTop: 14 }}>Add staff or a role</h2>
      <div className="row">
        <input
          placeholder="Telegram user id"
          value={telegramUserId}
          onChange={(e) => setTg(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          placeholder="Name"
          value={displayName}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1 }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ flex: 1 }}>
          {["owner", "cofounder", "finance", "support", "staff_reviewer"].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <button className="small" disabled={act.busy} onClick={add}>
          Save
        </button>
      </div>
      <Notice error={act.error} done={act.done} />
    </Panel>
  );
}

export const OwnerMoneyNote = () => (
  <p className="muted">
    These queues show every agent&apos;s requests. Acting on one is logged as an owner override.
  </p>
);
