"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal, flushSync } from "react-dom";
import { parseSlip, rawInfoText, withResults } from "@/lib/ticketSlip";
import type { TicketView } from "./TicketReceipt";

/*
 * The paper version of a ticket: a plain betting-shop receipt for 58mm/80mm
 * thermal printers (and phone print previews). Never visible on screen.
 *
 * It renders into a portal straight under <body>, and while it is mounted the
 * print stylesheet (globals.css, "Print receipt") hides every other child of
 * <body> — header, wallet, install banner, bottom nav, Telegram button,
 * modals, toasts — so window.print() outputs this receipt and nothing else.
 * The on-screen TicketReceipt is untouched and simply doesn't print.
 *
 * Reads the same TicketView and slip parsing as the screen receipt; it shows
 * the existing bet, it never computes or changes one.
 */

const CURRENCY = "ETB";
const noop = () => () => {};

const pad = (n: number) => String(n).padStart(2, "0");
/* 05/10/2026 20:50:46 — day first, the way betting-shop receipts read here. */
function dateTime(iso: string | Date): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const money = (v: string | number) =>
  `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${CURRENCY}`;

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? "pt-row pt-strong" : "pt-row"}>
      <span>{label}</span>
      <span className="pt-val">{value}</span>
    </div>
  );
}

export function PrintTicket({ ticket }: { ticket: TicketView }) {
  // Portals need document.body, so render nothing on the server pass.
  const onClient = useSyncExternalStore(noop, () => true, () => false);
  const [printedAt, setPrintedAt] = useState(() => new Date());

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-print-receipt", "");

    // Stamp the real print time, and give the print job / saved PDF a short
    // name instead of the long site title.
    let prevTitle = document.title;
    const before = () => {
      flushSync(() => setPrintedAt(new Date()));
      prevTitle = document.title;
      document.title = `VinnaBet ${ticket.publicId}`;
    };
    const after = () => { document.title = prevTitle; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      html.removeAttribute("data-print-receipt");
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [ticket.publicId]);

  if (!onClient) return null;

  return createPortal(
    <div id="print-ticket" className="print-ticket" aria-hidden="true">
      <header className="pt-head">
        <p className="pt-brand">VINNABET</p>
        <p className="pt-sub">Sports Betting Ticket</p>
        <p className="pt-id">{ticket.publicId}</p>
      </header>

      <section className="pt-block">
        <Row label="Placed:" value={dateTime(ticket.createdAt)} />
        <Row label="Status:" value={<b>{ticket.status.toUpperCase()}</b>} />
      </section>

      {ticket.bets.map((b, i) => {
        const slip = parseSlip(b.info);
        const selections = withResults(slip, b.resultInfo, b.settled);
        const potential = slip.totalOdds ? Number(b.betAmount) * Number(slip.totalOdds) : null;
        const won = b.settled && Number(b.winAmount) > 0;

        if (slip.selections.length === 0) {
          // Same rule as the screen receipt: never print a blank bet.
          return (
            <section key={b.id} className="pt-block pt-keep">
              <p className="pt-match">{b.gameName ?? `Bet ${i + 1}`}</p>
              <Row label="Stake:" value={money(b.betAmount)} />
              {won && <Row label="Won:" value={money(b.winAmount)} />}
              {b.info != null && <pre className="pt-raw">{rawInfoText(b.info)}</pre>}
            </section>
          );
        }

        return (
          <div key={b.id}>
            {selections.map((s, j) => (
              <section key={j} className="pt-block pt-keep">
                <p className="pt-match">{s.match}</p>
                {s.marketPick && <p>{s.marketPick}</p>}
                {s.odds && <p>Odds: {s.odds}</p>}
                {s.kickoff && <p>{s.kickoff}</p>}
                {s.result && <p>Status: {s.result.toUpperCase()}</p>}
              </section>
            ))}
            <section className="pt-block pt-keep">
              {slip.betType && <Row label="Bet Type:" value={slip.betType.toUpperCase()} />}
              {slip.totalOdds && (
                <Row label="Total Odds:" value={Number(slip.totalOdds).toLocaleString(undefined, { maximumFractionDigits: 2 })} />
              )}
              <Row label="Stake:" value={money(b.betAmount)} />
              {potential !== null && !b.settled && <Row label="Potential Win:" value={money(potential)} />}
              {won && <Row label="Won:" value={money(b.winAmount)} />}
            </section>
          </div>
        );
      })}

      <section className="pt-total pt-keep">
        <Row label="TOTAL STAKE:" value={money(ticket.totalStake)} strong />
        {Number(ticket.totalWin) > 0 && <Row label="WIN:" value={money(ticket.totalWin)} strong />}
        {ticket.paidAt && <Row label="Paid:" value={dateTime(ticket.paidAt)} />}
      </section>

      <footer className="pt-foot pt-keep">
        <p>Keep this ticket for reference.</p>
        <p>Ticket: {ticket.publicId}</p>
        <p>Printed: {dateTime(printedAt)}</p>
      </footer>
    </div>,
    document.body,
  );
}
