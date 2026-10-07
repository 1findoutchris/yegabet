"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal, flushSync } from "react-dom";
import { parseSlip, rawInfoText, ticketTotal } from "@/lib/ticketSlip";
import { code128B } from "@/lib/code128";
import { displayCode } from "@/lib/ticketCode";
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

/* Printed form of the ticket code: hyphens dropped ("T-UYE25F" → "TUYE25F").
   Display and barcode only; the stored code is unchanged. */
const printedId = displayCode;

/* Code 128 as SVG bars. Runs of bar modules merge into one rect so edges stay
   crisp; 10-module quiet zones either side keep it scannable. */
function Barcode({ value }: { value: string }) {
  let bits: string;
  try { bits = code128B(value); } catch { return null; }
  const quiet = 10;
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== "1") continue;
    const last = bars[bars.length - 1];
    if (last && last.x + last.w === i + quiet) last.w++;
    else bars.push({ x: i + quiet, w: 1 });
  }
  return (
    <svg className="pt-barcode" viewBox={`0 0 ${bits.length + quiet * 2} 40`} preserveAspectRatio="none"
      shapeRendering="crispEdges" role="img" aria-label={`Barcode ${value}`}>
      <rect width="100%" height="100%" fill="#fff" />
      {bars.map((b) => <rect key={b.x} x={b.x} width={b.w} height="40" fill="#000" />)}
    </svg>
  );
}

function Row({ label, value, strong, bold }: { label: string; value: React.ReactNode; strong?: boolean; bold?: boolean }) {
  return (
    <div className={strong ? "pt-row pt-strong" : bold ? "pt-row pt-bold" : "pt-row"}>
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

  // Possible payout of the whole ticket (stake × total odds per bet) — the
  // same figure as "Total" on the screen receipt. Printed once, under
  // TOTAL STAKE.
  const total = ticketTotal(ticket.bets);

  return createPortal(
    <div id="print-ticket" className="print-ticket" aria-hidden="true">
      <header className="pt-head">
        <p className="pt-brand">VINNABET</p>
        <p className="pt-sub">Sports Betting Ticket</p>
        <Barcode value={printedId(ticket.publicId)} />
        <p className="pt-id">{printedId(ticket.publicId)}</p>
      </header>

      <section className="pt-block">
        <Row label="Placed:" value={dateTime(ticket.createdAt)} />
      </section>

      {ticket.bets.map((b, i) => {
        const slip = parseSlip(b.info);
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
            {slip.selections.map((s, j) => (
              <section key={j} className="pt-block pt-keep">
                <p className="pt-match">{s.match}</p>
                {(s.marketPick || s.odds) && (
                  <div className="pt-pick">
                    <span>{s.marketPick}</span>
                    {s.odds && <b className="pt-odds">{s.odds}</b>}
                  </div>
                )}
                {s.kickoff && <p>{s.kickoff}</p>}
              </section>
            ))}
            <section className="pt-block pt-keep">
              {slip.betType && <Row label="Bet Type:" value={slip.betType.toUpperCase()} />}
              {slip.totalOdds && (
                <Row label="Total Odds:" value={Number(slip.totalOdds).toLocaleString(undefined, { maximumFractionDigits: 2 })} />
              )}
              <Row label="Stake:" value={money(b.betAmount)} />
              {won && <Row label="Won:" value={money(b.winAmount)} />}
            </section>
          </div>
        );
      })}

      <section className="pt-total pt-keep">
        <Row label="TOTAL STAKE:" value={money(ticket.totalStake)} strong />
        {total !== null && <Row label="Total:" value={money(total)} bold />}
        {Number(ticket.totalWin) > 0 && <Row label="WIN:" value={money(ticket.totalWin)} strong />}
        {ticket.paidAt && <Row label="Paid:" value={dateTime(ticket.paidAt)} />}
      </section>

      <footer className="pt-foot pt-keep">
        <p>Keep this ticket for reference.</p>
        <p>Ticket: {printedId(ticket.publicId)}</p>
        <p>Printed: {dateTime(printedAt)}</p>
      </footer>
    </div>,
    document.body,
  );
}
