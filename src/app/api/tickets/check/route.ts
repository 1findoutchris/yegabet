import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/adminAuth";
import { allowCheck, checkTicket, normalizeCode } from "@/lib/ticketCheck";

/**
 * GET ?code= — public "Check Ticket". No login: anyone holding a ticket code
 * (T-XXXXXX agent ticket, P-XXXXXXXX player bet; hyphen optional) can see its matches,
 * per-match results, stake and status. Nothing identifying the owner is
 * returned (see lib/ticketCheck). Rate-limited per IP.
 */
export async function GET(req: NextRequest) {
  if (!(await allowCheck(getClientIp(req)))) {
    return NextResponse.json({ error: "Too many checks — wait a minute and try again" }, { status: 429 });
  }

  const raw = req.nextUrl.searchParams.get("code") ?? "";
  if (!normalizeCode(raw)) {
    return NextResponse.json({ error: "Enter a ticket code like T3F9K2A or P7KX2M9QD" }, { status: 400 });
  }

  const ticket = await checkTicket(raw);
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}
