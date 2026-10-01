"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { TicketList } from "@/components/tickets/TicketList";
import { TicketsLoginPrompt } from "@/components/tickets/TicketsLoginPrompt";

/*
 * Player "Ticket History" + "Find Ticket" — the in-person agent's ticket
 * page (TicketList), pointed at the player's own sportsbook bets.
 * ?find=1 (the "Find Ticket" menu entry) focuses the search box.
 */
function PlayerTickets() {
  const { data: session, status } = useSession();
  const find = useSearchParams().get("find") === "1";

  if (status === "loading") return null;
  if (!session) return <TicketsLoginPrompt />;

  return (
    <TicketList
      title={find ? "Find Ticket" : "Ticket History"}
      apiPath="/api/user/tickets"
      hrefBase="/tickets"
      placeholder="Search ticket ID or team name…"
      emptyText="No sports tickets yet"
      autoFocusSearch={find}
    />
  );
}

export default function PlayerTicketsPage() {
  return (
    <Suspense>
      <PlayerTickets />
    </Suspense>
  );
}
