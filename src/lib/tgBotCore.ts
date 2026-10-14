// The YegaBet player bot — pure pieces (command parsing, message text), split
// out of tgBot.ts so they're testable without a token, redis or a database.

import { parseSlip, withResults } from "./ticketSlip";
import { displayCode } from "./ticketCode";

export type BotCommand =
  | "start"
  | "menu"
  | "account"
  | "verify"
  | "ticket"
  | "help"
  | "unlink"
  | "cancel";

const COMMANDS = new Set<BotCommand>(["start", "menu", "account", "verify", "ticket", "help", "unlink", "cancel"]);

/**
 * "/ticket T3F9K2A" → { cmd: "ticket", arg: "T3F9K2A" }. "/start@VinnaBot x"
 * (the group form) parses the same. Unknown commands come back as "help" so
 * the user always gets an answer; plain text is null.
 */
export function parseCommand(text: string): { cmd: BotCommand; arg: string | null } | null {
  const m = /^\/([A-Za-z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const name = m[1].toLowerCase() as BotCommand;
  const arg = m[2]?.trim() || null;
  return { cmd: COMMANDS.has(name) ? name : "help", arg };
}

/** Escape for parse_mode HTML. Anything from a user or a provider goes through
 *  this — a match name with "<" would otherwise make Telegram reject the whole
 *  message, and a first name could inject a link. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const etb = (n: number) =>
  `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;

/** The subset of lib/ticketCheck's PublicTicket the summary reads. */
export type TicketForBot = {
  publicId: string;
  status: string;
  totalStake: string;
  totalWin: string;
  bets: { betAmount: string; winAmount: string; settled: boolean; gameName: string | null; info: string | null; resultInfo: string | null }[];
};

const MAX_LEGS = 15;
const LEG_MARK = { won: "✅", lost: "❌", open: "⏳" } as const;

/**
 * A ticket as a Telegram message: code, status, stake, odds, selections and
 * the potential or actual win — the same figures the Check Ticket page shows
 * (TicketReceipt), from the same public, owner-free data.
 */
export function ticketSummary(t: TicketForBot): string {
  const lines = [`🎫 <b>Ticket ${esc(displayCode(t.publicId))}</b>`, `Status: <b>${esc(t.status)}</b>`, ""];

  let potential = 0;
  let anyPotential = false;
  for (const b of t.bets) {
    const slip = parseSlip(b.info);
    const legs = withResults(slip, b.resultInfo, b.settled);
    if (legs.length) {
      for (const s of legs.slice(0, MAX_LEGS)) {
        const mark = s.result ? `${LEG_MARK[s.result]} ` : "• ";
        const pick = [s.marketPick, s.odds ? `@ ${s.odds}` : null].filter(Boolean).join(" ");
        lines.push(`${mark}${esc(s.match)}${pick ? `\n   ${esc(pick)}` : ""}`);
      }
      if (legs.length > MAX_LEGS) lines.push(`… and ${legs.length - MAX_LEGS} more`);
    } else {
      lines.push(`• ${esc(b.gameName ?? "Bet")} — ${etb(Number(b.betAmount))}`);
    }
    if (slip.totalOdds) {
      lines.push(`Total odds: <b>${esc(Number(slip.totalOdds).toLocaleString("en-US", { maximumFractionDigits: 2 }))}</b>`);
      if (!b.settled) {
        potential += Number(b.betAmount) * Number(slip.totalOdds);
        anyPotential = true;
      }
    }
  }

  lines.push("", `Stake: <b>${etb(Number(t.totalStake))}</b>`);
  if (Number(t.totalWin) > 0) lines.push(`Won: <b>${etb(Number(t.totalWin))}</b>`);
  else if (anyPotential && Number.isFinite(potential)) lines.push(`Potential win: <b>${etb(potential)}</b>`);
  return lines.join("\n");
}
