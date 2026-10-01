"use client";

import { TicketList } from "@/components/tickets/TicketList";

/*
 * Agent ticket history + lookup. The search bar is what the agent uses when a
 * customer walks back in: type the ticket code and the row surfaces.
 */
export default function AgentTicketsPage() {
  return (
    <TicketList
      title="Tickets"
      apiPath="/api/agent/tickets"
      hrefBase="/agent/tickets"
      placeholder="Search ticket code, customer name or phone…"
    />
  );
}
