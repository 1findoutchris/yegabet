"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Save, Check, Plus, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DepositBonusConfig } from "@/lib/depositBonusCore";
import { useRewardConfig } from "./useRewardConfig";

/* Shared editors for the reward config blocks, split across one page per
   section (see ./layout.tsx). Each block saves independently by POSTing
   { key, value } to /api/admin/rewards. Values are validated server-side; the
   code defaults apply until a block is first saved.

   Not a `page.tsx`, so the App Router doesn't route it. */

export type Row = Record<string, unknown>;

type ColType = "text" | "number" | "select" | "badge";
export interface Col {
  key: string;
  label: string;
  type: ColType;
  options?: string[];
  width?: string;
  nullable?: boolean; // number that may be blank = null (e.g. tier max)
}

const CHALLENGE_METRICS = ["wager", "bets", "deposit"];
const ACHIEVEMENT_METRICS = ["bets", "wins", "bigWin", "wagered", "deposits", "points"];

/** One entry per CRUD list block; the section pages pick theirs out by key. */
export const BLOCKS: {
  key: string;
  title: string;
  cols: Col[];
  newRow: () => Row;
}[] = [
  {
    key: "streakMilestones",
    title: "Streak milestones",
    cols: [
      { key: "day", label: "Day", type: "number", width: "70px" },
      { key: "points", label: "Points", type: "number", width: "90px" },
      { key: "etb", label: "ETB bonus", type: "number", width: "90px" },
      { key: "reward", label: "Reward copy", type: "text" },
    ],
    newRow: () => ({ day: 0, points: 0, etb: 0, reward: "" }),
  },
  {
    // Bigger than the three shown per day on purpose — the card rotates through
    // the pool, so a short list means players see the same tasks repeatedly.
    key: "dailyChallenges",
    title: "Daily challenges (pool — 3 shown per day)",
    cols: [
      { key: "id", label: "ID", type: "text", width: "110px" },
      { key: "title", label: "Title", type: "text" },
      { key: "segment", label: "Segment", type: "text", width: "130px" },
      { key: "metric", label: "Metric", type: "select", options: CHALLENGE_METRICS, width: "100px" },
      { key: "target", label: "Target", type: "number", width: "90px" },
      { key: "unit", label: "Unit", type: "text", width: "70px" },
      { key: "points", label: "Points", type: "number", width: "80px" },
    ],
    newRow: () => ({ id: "", title: "", segment: "All players", metric: "wager", target: 0, unit: "ETB", points: 0 }),
  },
  {
    key: "weeklyChallenges",
    title: "Weekly challenges",
    cols: [
      { key: "id", label: "ID", type: "text", width: "110px" },
      { key: "title", label: "Title", type: "text" },
      { key: "segment", label: "Segment", type: "text", width: "130px" },
      { key: "metric", label: "Metric", type: "select", options: CHALLENGE_METRICS, width: "100px" },
      { key: "target", label: "Target", type: "number", width: "90px" },
      { key: "unit", label: "Unit", type: "text", width: "70px" },
      { key: "points", label: "Points", type: "number", width: "80px" },
    ],
    newRow: () => ({ id: "", title: "", segment: "All players", metric: "wager", target: 0, unit: "ETB", points: 0 }),
  },
  {
    key: "tiers",
    title: "Tiers & cashback",
    cols: [
      { key: "id", label: "ID", type: "text", width: "90px" },
      { key: "name", label: "Name", type: "text", width: "100px" },
      { key: "min", label: "Min pts", type: "number", width: "90px" },
      { key: "max", label: "Max pts", type: "number", width: "90px", nullable: true },
      { key: "cashback", label: "Label", type: "text", width: "70px" },
      { key: "cashbackRate", label: "Rate (0-1)", type: "number", width: "90px" },
      { key: "cashbackCap", label: "Cap ETB", type: "number", width: "90px" },
      { key: "color", label: "Color", type: "text", width: "90px" },
      { key: "badge", label: "Badge", type: "badge", width: "120px" },
    ],
    newRow: () => ({ id: "", name: "", min: 0, max: null, cashback: "0%", cashbackRate: 0, cashbackCap: 0, color: "#CD7F32", badge: "/badges/bronze.svg" }),
  },
  {
    key: "achievements",
    title: "Achievements",
    cols: [
      { key: "id", label: "ID", type: "text", width: "110px" },
      { key: "name", label: "Name", type: "text", width: "120px" },
      { key: "desc", label: "Description", type: "text" },
      { key: "metric", label: "Metric", type: "select", options: ACHIEVEMENT_METRICS, width: "100px" },
      { key: "target", label: "Target", type: "number", width: "90px" },
      { key: "badge", label: "Badge", type: "badge", width: "120px" },
    ],
    newRow: () => ({ id: "", name: "", desc: "", badge: "/badges/bronze.svg", metric: "bets", target: 1 }),
  },
];

const ECONOMY_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "pointsPerEtbWagered", label: "Points per ETB wagered" },
  { key: "winBonusPct", label: "Win bonus rate", hint: "0–1 (0.25 = 25% of win as points)" },
  { key: "dailyPlayPoints", label: "Daily play points" },
  { key: "firstDepositOfWeekPoints", label: "First deposit of week points" },
  { key: "minStreakBet", label: "Min stake counting for streak (ETB)" },
  { key: "pointsPerEtb", label: "Points per ETB redeemed", hint: "50 = 2% of turnover back as bonus. Lower is more generous." },
  { key: "minRedeemPoints", label: "Min points per redemption", hint: "Also the step — redemptions must be a multiple of points-per-ETB" },
];

/**
 * Shared loading/error shell. Every section page is this plus one editor, which
 * is why the pages themselves are only a few lines each.
 */
export function Section({
  children,
}: {
  children: (ctx: {
    config: Record<string, unknown>;
    adminFetch: (p: string, i?: RequestInit) => Promise<Response>;
  }) => React.ReactNode;
}) {
  const { config, loading, error, adminFetch } = useRewardConfig();

  if (error) {
    return (
      <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">
        {error}
      </p>
    );
  }
  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }
  return <>{children({ config, adminFetch })}</>;
}

/** A whole CRUD list section, picked out of BLOCKS by key. */
export function BlockSection({ blockKey }: { blockKey: string }) {
  const { secret } = useParams<{ secret: string }>();
  const block = BLOCKS.find((b) => b.key === blockKey);
  if (!block) return null;

  return (
    <Section>
      {({ config, adminFetch }) => (
        <BlockEditor
          blockKey={block.key}
          title={block.title}
          cols={block.cols}
          newRow={block.newRow}
          initial={(config[block.key] as Row[]) ?? []}
          adminFetch={adminFetch}
          secret={secret}
        />
      )}
    </Section>
  );
}

// ── Deposit bonus (two independently toggleable rules) ─────────────────────
export function DepositBonusEditor({
  initial,
  adminFetch,
}: {
  initial: DepositBonusConfig;
  adminFetch: (p: string, i?: RequestInit) => Promise<Response>;
}) {
  const [draft, setDraft] = useState<DepositBonusConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function setRule<R extends keyof DepositBonusConfig>(
    rule: R,
    patch: Partial<DepositBonusConfig[R]>,
  ) {
    setDraft((d) => ({ ...d, [rule]: { ...d[rule], ...patch } }));
  }

  async function save() {
    setSaving(true);
    setError("");
    const res = await adminFetch("/rewards", {
      method: "POST",
      body: JSON.stringify({ key: "depositBonus", value: draft }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed to save.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const input = "w-full h-9 px-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]";

  // What the most generous enabled rule costs on its own cap. Both rules never
  // stack — the better one pays — so this really is the worst case per deposit.
  const worstCase = Math.max(
    draft.firstDeposit.enabled ? draft.firstDeposit.maxEtb : 0,
    draft.reload.enabled ? draft.reload.maxEtb : 0,
  );

  const rules: { id: keyof DepositBonusConfig; title: string; hint: string }[] = [
    { id: "firstDeposit", title: "Welcome bonus", hint: "Pays once, on a player's very first deposit." },
    { id: "reload", title: "Custom % bonus", hint: "Pays on every deposit while it's on, including first ones." },
  ];

  return (
    <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
      <h2 className="text-[15px] font-bold text-[color:var(--text-primary)]">Deposit bonuses</h2>
      <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 mb-4">
        Credited as locked bonus funds — playable, but the player must wager them before withdrawing.
        Both rules can run at once; if both apply to one deposit the player gets the better of the two,
        never the sum.
      </p>

      {error && <p className="text-[13px] text-[color:var(--red)] mb-3">{error}</p>}

      <div className="grid md:grid-cols-2 gap-4">
        {rules.map(({ id, title, hint }) => {
          const rule = draft[id];
          return (
            <div key={id} className="rounded-xl border border-[color:var(--border-muted)] p-3 space-y-2.5">
              <label className="flex items-center gap-2 text-[13px] font-bold text-[color:var(--text-primary)]">
                <input type="checkbox" checked={rule.enabled}
                  onChange={(e) => setRule(id, { enabled: e.target.checked })} />
                {title}
              </label>
              <p className="text-[11px] text-[color:var(--text-muted)]">{hint}</p>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)] mb-1">Bonus %</label>
                  <input type="number" min={0} max={100} step="1" className={input}
                    value={Math.round(rule.pct * 100)}
                    onChange={(e) => setRule(id, { pct: Number(e.target.value) / 100 })} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)] mb-1">Max ETB</label>
                  <input type="number" min={0} className={input} value={rule.maxEtb}
                    onChange={(e) => setRule(id, { maxEtb: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)] mb-1">Min dep.</label>
                  <input type="number" min={0} className={input} value={rule.minDepositEtb}
                    onChange={(e) => setRule(id, { minDepositEtb: Number(e.target.value) })} />
                </div>
              </div>

              {id === "reload" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)] mb-1">From (optional)</label>
                    <input type="date" className={input} value={draft.reload.startsAt}
                      onChange={(e) => setRule("reload", { startsAt: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)] mb-1">Until (optional)</label>
                    <input type="date" className={input} value={draft.reload.endsAt}
                      onChange={(e) => setRule("reload", { endsAt: e.target.value })} />
                  </div>
                </div>
              )}

              {id === "reload" && (
                <p className="text-[10px] text-[color:var(--text-muted)]">
                  Leave the dates blank to run until you switch it off. Set them and it expires on its own.
                </p>
              )}
              {rule.maxEtb === 0 && rule.enabled && (
                <p className="text-[10px] text-[color:var(--red)]">Max 0 means this rule pays nothing.</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-4">
        <p className="text-[11px] text-[color:var(--text-muted)]">
          Most a single deposit can earn:{" "}
          <b className={worstCase > 5000 ? "text-[color:var(--red)]" : "text-[color:var(--text-secondary)]"}>
            ETB {worstCase.toLocaleString()}
          </b>
        </p>
        <button onClick={save} disabled={saving}
          className={cn("ml-auto inline-flex items-center gap-2 px-4 h-9 rounded-xl text-[13px] font-bold",
            saved ? "bg-[var(--green)] text-[#09090B]" : "bg-gold-grad text-[#09090B]")}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" />
            : saved ? <><Check className="w-4 h-4" /> Saved</>
            : <><Save className="w-4 h-4" /> Save</>}
        </button>
      </div>
    </div>
  );
}

// ── Points economy (single object) ─────────────────────────────────────────
export function EconomyEditor({
  initial,
  adminFetch,
}: {
  initial: Record<string, number>;
  adminFetch: (p: string, i?: RequestInit) => Promise<Response>;
}) {
  const [draft, setDraft] = useState<Record<string, number>>({ ...initial });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const res = await adminFetch("/rewards", {
        method: "POST",
        body: JSON.stringify({ key: "pointsEconomy", value: draft }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? "Failed to save.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      setErr("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
      <h2 className="text-[15px] font-bold text-[color:var(--text-primary)] mb-1">Points economy &amp; deposit bonus</h2>
      <p className="text-[12px] text-[color:var(--text-muted)] mb-4">Loyalty point rates, streak stake threshold, bonus wagering and the referral / first-deposit bonuses.</p>
      {err && <p className="text-[12px] text-[color:var(--red)] mb-3">{err}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {ECONOMY_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">{f.label}</label>
            <NumberInput
              value={draft[f.key] ?? 0}
              onChange={(v) => setDraft((p) => ({ ...p, [f.key]: v ?? 0 }))}
              className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] focus:outline-none focus:border-[color:var(--border-accent)]"
            />
            {f.hint && <p className="text-[10px] text-[color:var(--text-muted)] mt-1">{f.hint}</p>}
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <SaveButton onClick={save} saving={saving} saved={saved} />
      </div>
    </section>
  );
}

// ── Generic list block (add / remove / edit rows) ───────────────────────────
export function BlockEditor({
  blockKey,
  title,
  cols,
  newRow,
  initial,
  adminFetch,
  secret,
}: {
  blockKey: string;
  title: string;
  cols: Col[];
  newRow: () => Row;
  initial: Row[];
  adminFetch: (p: string, i?: RequestInit) => Promise<Response>;
  secret: string;
}) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  function setCell(idx: number, key: string, value: unknown) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  }

  async function uploadBadge(idx: number, file: File) {
    const row = rows[idx];
    const slug = String(row.id || row.name || `badge-${idx}`);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("slug", slug);
    // Raw fetch: don't force JSON content-type so the multipart boundary is set.
    const res = await fetch("/api/admin/rewards/badge", {
      method: "POST",
      headers: { "x-admin-secret": secret },
      body: fd,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(d.error ?? "Badge upload failed."); return; }
    setCell(idx, "badge", d.url);
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const res = await adminFetch("/rewards", {
        method: "POST",
        body: JSON.stringify({ key: blockKey, value: rows }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? "Failed to save.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      setErr("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-bold text-[color:var(--text-primary)]">{title}</h2>
        <button
          onClick={() => setRows((p) => [...p, newRow()])}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[color:var(--gold)] hover:opacity-80"
        >
          <Plus className="w-4 h-4" /> Add row
        </button>
      </div>
      {err && <p className="text-[12px] text-[color:var(--red)] mb-3">{err}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">
              {cols.map((c) => (
                <th key={c.key} className="pb-2 pr-2 font-medium" style={{ width: c.width }}>{c.label}</th>
              ))}
              <th className="pb-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-t border-[color:var(--border-muted)]">
                {cols.map((c) => (
                  <td key={c.key} className="py-1.5 pr-2 align-middle">
                    <Cell col={c} value={row[c.key]} onChange={(v) => setCell(idx, c.key, v)} onUpload={(f) => uploadBadge(idx, f)} />
                  </td>
                ))}
                <td className="py-1.5">
                  <button
                    onClick={() => setRows((p) => p.filter((_, i) => i !== idx))}
                    className="text-[color:var(--text-muted)] hover:text-[color:var(--red)]"
                    aria-label="Remove row"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end mt-4">
        <SaveButton onClick={save} saving={saving} saved={saved} />
      </div>
    </section>
  );
}

/**
 * Numeric field that keeps what you actually typed while you type it.
 *
 * The obvious `value={someNumber}` + `onChange={Number(e.target.value)}` pair
 * is broken for decimals: typing "0.04" passes through "0.", which `Number()`
 * turns into 0, which re-renders as "0" and eats the decimal point — so rates
 * like 0.04 can never be entered. Holding the raw string locally and only
 * reporting a parsed number upward is what fixes it.
 */
function NumberInput({
  value,
  onChange,
  nullable = false,
  placeholder,
  className,
}: {
  value: unknown;
  onChange: (v: number | null) => void;
  nullable?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const asText = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const text = asText(value);
  const [raw, setRaw] = useState(text);

  // Adopt changes that come from outside (block reload, row add/remove) but
  // ignore the echo of our own onChange — the parent normalises "0." to 0 and
  // sends it straight back, which is exactly what must not overwrite the draft.
  useEffect(() => {
    setRaw((cur) => (Number.isNaN(Number(cur)) || Number(cur) === Number(text) ? cur : text));
  }, [text]);

  return (
    <input
      // `text` + inputMode, not type="number": a number input also fights
      // decimals and mutates on scroll-wheel over a focused field.
      type="text"
      inputMode="decimal"
      value={raw}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        const next = e.target.value;
        // Allow only partial-number shapes, so the caret never jumps on junk.
        if (!/^-?\d*\.?\d*$/.test(next)) return;
        setRaw(next);
        if (next === "" || next === "-" || next === ".") {
          onChange(nullable && next === "" ? null : 0);
          return;
        }
        const n = Number(next);
        if (!Number.isNaN(n)) onChange(n);
      }}
      // Settle the display on the canonical value once editing stops ("0." → "0").
      onBlur={() => setRaw(asText(value))}
    />
  );
}

function Cell({
  col,
  value,
  onChange,
  onUpload,
}: {
  col: Col;
  value: unknown;
  onChange: (v: unknown) => void;
  onUpload: (f: File) => void;
}) {
  const inputCls =
    "w-full h-9 px-2 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]";

  if (col.type === "select") {
    return (
      <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {col.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (col.type === "number") {
    return (
      <NumberInput
        value={value}
        nullable={col.nullable}
        placeholder={col.nullable ? "∞" : "0"}
        onChange={onChange}
        className={inputCls}
      />
    );
  }

  if (col.type === "badge") {
    const url = String(value ?? "");
    return (
      <div className="flex items-center gap-2">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" width={24} height={24} style={{ width: 24, height: 24 }} />
        )}
        <input value={url} onChange={(e) => onChange(e.target.value)} placeholder="/badges/x.svg" className={inputCls} />
        <label className="shrink-0 cursor-pointer text-[color:var(--text-muted)] hover:text-[color:var(--gold)]" title="Upload badge">
          <Upload className="w-4 h-4" />
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
          />
        </label>
      </div>
    );
  }

  return <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
}

function SaveButton({ onClick, saving, saved }: { onClick: () => void; saving: boolean; saved: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className={cn(
        "inline-flex items-center gap-2 px-4 h-10 rounded-xl text-[13px] font-bold transition-all",
        saved ? "bg-[var(--green)] text-[#09090B]" : "bg-gold-grad text-[#09090B] hover:scale-[1.02]"
      )}
    >
      {saving ? <Loader2 className="w-4 h-4 animate-spin" />
        : saved ? <><Check className="w-4 h-4" /> Saved</>
        : <><Save className="w-4 h-4" /> Save</>}
    </button>
  );
}
