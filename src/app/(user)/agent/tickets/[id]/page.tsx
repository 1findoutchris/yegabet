"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, Printer, CheckCircle2, Upload } from "lucide-react";

/*
 * Ticket detail — doubles as the printable receipt the customer carries.
 * ?print=1 auto-opens the browser print dialog (thermal printers just work —
 * they print the page). When the customer returns to collect a win, the agent
 * verifies name/phone against this view, pays cash, attaches the receipt
 * photo, and marks it paid.
 */

interface TicketDetail {
  id: string;
  publicId: string;
  customerName: string;
  customerPhone: string;
  status: string;
  totalStake: string;
  totalWin: string;
  createdAt: string;
  paidAt: string | null;
  bets: {
    id: string;
    betAmount: string;
    winAmount: string;
    settled: boolean;
    gameRound: string | null;
    gameId: string | null;
    gameName: string | null;
    info: unknown;
    transaction: { reference: string; createdAt: string };
  }[];
}

/*
 * Best-effort extraction of bet-slip selections from the provider's `info`
 * blob, rendered in the convention bettors know from the BetBy slip:
 *
 *   Netherlands - Germany
 *   1x2 Netherlands
 *   Odds: 2.54
 *
 * The exact shape is provider-defined, so we walk it looking for objects that
 * smell like selections — a name/teams field plus an odds or pick field.
 * Anything unrecognized just yields no selections; the game name still shows.
 */
interface SlipSelection {
  match: string;
  marketPick: string | null;
  odds: string | null;
}

interface Slip {
  selections: SlipSelection[];
  totalOdds: string | null;
  betType: string | null;
}

function parseSlip(info: unknown): Slip {
  const empty: Slip = { selections: [], totalOdds: null, betType: null };
  let data = info;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return empty; }
  }
  if (!data || typeof data !== "object") return empty;

  const selections: SlipSelection[] = [];
  const seen = new Set<unknown>();
  let totalOdds: string | null = null;
  let betType: string | null = null;

  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);
  const pick = (o: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      const s = text(o[k]);
      if (s) return s;
    }
    return null;
  };

  const NAME_KEYS = ["match", "event", "eventName", "game", "gameName", "title", "name", "teams", "fixture"];
  const MARKET_KEYS = ["market", "marketName", "market_type_name", "betType", "type"];
  const PICK_KEYS = ["pick", "selection", "outcome", "choice", "bet", "outcomeName", "selectionName", "outcome_display_name"];
  // Handicap/total line values ("-1.5", "2.5") — may arrive separately from
  // the pick text; without them a handicap bet reads wrong.
  const LINE_KEYS = ["line", "param", "parameter", "handicap", "base", "total", "points", "value", "lineValue"];
  const ODDS_KEYS = ["odds", "odd", "price", "coefficient", "coef", "coeficient"];
  const TOTAL_ODDS_KEYS = ["totalOdds", "total_odds", "combinedOdds", "accOdds"];
  const TYPE_KEYS = ["type", "betType", "slipType", "mode"];

  /*
   * Real Gregmorn/BetBy shape (verified against prod): `info` arrives as a
   * JSON string; its `detail` field is ANOTHER JSON string carrying
   * `legs[]` — team1/team2, market_type_name, outcome_display_name,
   * coeficient (their typo), handicap/base for line values. `k` = total odds.
   */
  const root = data as Record<string, unknown>;
  let detail: unknown = root.detail;
  if (typeof detail === "string") {
    try { detail = JSON.parse(detail); } catch { detail = null; }
  }
  const legs = (detail as Record<string, unknown> | null)?.legs;
  if (Array.isArray(legs) && legs.length > 0) {
    const d = detail as Record<string, unknown>;
    return {
      selections: legs.map((leg) => {
        const l = leg as Record<string, unknown>;
        const match =
          [text(l.team1), text(l.team2)].filter(Boolean).join(" - ") ||
          pick(l, NAME_KEYS) ||
          "Selection";
        const market = text(l.market_type_name) ?? pick(l, MARKET_KEYS);
        const sel = text(l.outcome_display_name) ?? pick(l, PICK_KEYS);
        const line = text(l.handicap) ?? text(l.base);
        const pickText = line && !(sel ?? "").includes(line) ? `(${line}) ${sel ?? ""}`.trim() : sel;
        return {
          match,
          marketPick: [market, pickText].filter(Boolean).join(" ") || null,
          odds: text(l.coeficient) ?? pick(l, ODDS_KEYS),
        };
      }),
      totalOdds: text(d.k) ?? pick(d, TOTAL_ODDS_KEYS),
      betType: legs.length > 1 ? "Combo" : "Single",
    };
  }

  function looksLikeSelection(o: Record<string, unknown>): boolean {
    return NAME_KEYS.some((k) => text(o[k])) && (ODDS_KEYS.some((k) => text(o[k])) || PICK_KEYS.some((k) => text(o[k])));
  }

  function walk(v: unknown, depth: number) {
    if (!v || typeof v !== "object" || seen.has(v) || depth > 8) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    const o = v as Record<string, unknown>;
    if (looksLikeSelection(o)) {
      const market = pick(o, MARKET_KEYS);
      const sel = pick(o, PICK_KEYS);
      const line = pick(o, LINE_KEYS);
      // BetBy convention: "Handicap (-1.5) Netherlands", "Total over 2.5".
      // If the pick already carries the line ("over 2.5") don't double it.
      const pickText = line && !(sel ?? "").includes(line) ? `(${line}) ${sel ?? ""}`.trim() : sel;
      selections.push({
        match: pick(o, NAME_KEYS)!,
        marketPick: [market, pickText].filter(Boolean).join(" ") || null,
        odds: pick(o, ODDS_KEYS),
      });
      return; // don't double-count nested dupes of the same selection
    }
    // Top-level slip metadata — first match wins, shallow levels only.
    if (!totalOdds) totalOdds = pick(o, TOTAL_ODDS_KEYS);
    if (!betType) {
      const t = pick(o, TYPE_KEYS);
      if (t && t.length < 20) betType = t;
    }
    Object.values(o).forEach((x) => walk(x, depth + 1));
  }
  walk(data, 0);
  return { selections, totalOdds, betType };
}

/*
 * Last-resort rendering for an unrecognized payload: prefer the nested
 * `detail` blob (that's where the bet data lives), else the whole thing.
 * Keeps the printout useful — and the failure visible — instead of blank.
 */
function rawInfoText(info: unknown): string {
  let data = info;
  if (typeof data === "string") {
    const raw = data;
    try { data = JSON.parse(raw); } catch { return raw; }
  }
  if (data && typeof data === "object") {
    let detail = (data as Record<string, unknown>).detail;
    if (typeof detail === "string") {
      try { detail = JSON.parse(detail); } catch { /* keep raw string */ }
    }
    return JSON.stringify(detail ?? data, null, 1).slice(0, 2000);
  }
  return String(data);
}

export default function AgentTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const printed = useRef(false);

  // Browser print headers show the document title — keep it short so the
  // long site title doesn't print at the top of the ticket.
  useEffect(() => {
    const prev = document.title;
    document.title = "VinnaBet";
    return () => { document.title = prev; };
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/agent/tickets/${id}`);
    if (!res.ok) { setError("Ticket not found"); return; }
    const d = await res.json();
    setTicket(d.ticket);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Auto-print once when arriving from "Issue & print"
  useEffect(() => {
    if (ticket && searchParams.get("print") === "1" && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 400);
    }
  }, [ticket, searchParams]);

  async function markPaid() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Attach the payment receipt first"); return; }
    setBusy(true); setError("");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/agent/tickets/${id}/pay`, { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not mark paid");
      return;
    }
    load();
  }

  if (error && !ticket) return <div className="p-8 text-center text-[color:var(--red)]">{error}</div>;
  if (!ticket) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto">
      {/* Printable ticket body */}
      <div className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-5 print:border-black print:bg-white print:text-black">
        <div className="text-center border-b border-dashed border-[color:var(--border-muted)] pb-3 mb-3">
          <p className="font-display text-2xl font-extrabold tracking-wide flex items-baseline justify-center gap-2">
            Vinna<span className="text-gold-grad print:text-black">Bet</span>
            <span className="text-[11px] font-normal tracking-normal text-[color:var(--text-muted)] print:text-black">Bet Ticket</span>
          </p>
        </div>

        <p className="text-center font-mono text-xl font-bold tracking-widest mb-3">{ticket.publicId}</p>

        <div className="text-[12px] space-y-1 mb-3">
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Customer</span><span className="font-semibold">{ticket.customerName}</span></div>
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Phone</span><span>{ticket.customerPhone}</span></div>
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Placed</span><span>{new Date(ticket.createdAt).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Status</span><span className="font-bold uppercase">{ticket.status}</span></div>
        </div>

        <div className="border-t border-dashed border-[color:var(--border-muted)] pt-3 mb-3">
          {ticket.bets.map((b, i) => {
            const slip = parseSlip(b.info);
            const potential = slip.totalOdds ? Number(b.betAmount) * Number(slip.totalOdds) : null;
            return (
              <div key={b.id} className="text-[12px] mb-3 last:mb-0">
                {slip.selections.length > 0 ? (
                  <>
                    {slip.selections.map((s, j) => (
                      <div key={j} className="py-2 border-b border-[color:var(--border-muted)]">
                        <p className="font-semibold">{s.match}</p>
                        {s.marketPick && <p>{s.marketPick}</p>}
                        {s.odds && <p>Odds: {s.odds}</p>}
                      </div>
                    ))}
                    {(slip.totalOdds || slip.betType) && (
                      <div className="flex justify-between py-2 border-b border-[color:var(--border-muted)]">
                        {slip.totalOdds && <span>Total Odds: {slip.totalOdds}</span>}
                        {slip.betType && <span className="ml-auto">{slip.betType}</span>}
                      </div>
                    )}
                    <div className="py-2 text-right space-y-0.5">
                      <p>Stake: {Number(b.betAmount).toLocaleString()} ETB</p>
                      {potential !== null && !b.settled && (
                        <p>Potential Win: {potential.toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB</p>
                      )}
                      {b.settled && Number(b.winAmount) > 0 && (
                        <p className="text-emerald-500 font-semibold">Won: {Number(b.winAmount).toLocaleString()} ETB</p>
                      )}
                      <p className="text-[color:var(--text-muted)]">{new Date(b.transaction.createdAt).toLocaleString()}</p>
                    </div>
                  </>
                ) : (
                  <div className="py-1">
                    <div className="flex justify-between">
                      <span className="font-semibold">{b.gameName ?? `Bet ${i + 1}`}</span>
                      <span>
                        {Number(b.betAmount).toLocaleString()} ETB
                        {b.settled && Number(b.winAmount) > 0 && (
                          <span className="text-emerald-500"> → {Number(b.winAmount).toLocaleString()}</span>
                        )}
                      </span>
                    </div>
                    {/* Never print a blank bet: if the provider payload has an
                        unrecognized shape, dump it so the slip still shows what
                        was bet (and the failure is visible, not silent). */}
                    {b.info != null && (
                      <pre className="mt-1 text-[10px] leading-tight text-[color:var(--text-muted)] whitespace-pre-wrap break-all font-mono">
                        {rawInfoText(b.info)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-dashed border-[color:var(--border-muted)] pt-3 flex justify-between text-[13px] font-bold">
          <span>Total stake</span><span>{Number(ticket.totalStake).toLocaleString()} ETB</span>
        </div>
        {Number(ticket.totalWin) > 0 && (
          <div className="flex justify-between text-[13px] font-bold text-emerald-500 mt-1">
            <span>Win</span><span>{Number(ticket.totalWin).toLocaleString()} ETB</span>
          </div>
        )}
        {ticket.paidAt && (
          <p className="text-[11px] text-[color:var(--text-muted)] mt-2">Paid {new Date(ticket.paidAt).toLocaleString()}</p>
        )}
      </div>

      {/* Actions — hidden when printing */}
      <div className="mt-4 space-y-3 print:hidden">
        {error && <p className="text-[12px] text-[color:var(--red)]">{error}</p>}

        <button onClick={() => window.print()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] font-semibold text-[color:var(--text-primary)]">
          <Printer className="w-4 h-4" /> Print ticket
        </button>

        {ticket.status === "WON" && (
          <div className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-4 space-y-3">
            <p className="text-[12px] text-[color:var(--text-secondary)]">
              Verify the customer&apos;s name and phone above, hand over{" "}
              <span className="font-bold text-emerald-400">{Number(ticket.totalWin).toLocaleString()} ETB</span>,
              then attach the receipt.
            </p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-dashed border-[color:var(--border-muted)] text-[13px] text-[color:var(--text-secondary)]">
              <Upload className="w-4 h-4" /> Attach payment receipt
            </button>
            <button onClick={markPaid} disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-[13px] font-bold disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Mark as paid
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
