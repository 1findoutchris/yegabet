import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";
import { generateTicketCode } from "@/lib/tickets";

/**
 * GET — the agent's tickets, newest first. `?search=` matches the ticket code
 * (what the agent types when a customer walks back in holding a ticket).
 */
export async function GET(req: NextRequest) {
  const auth = await requireInPersonAgent();
  if (isAgentAuthError(auth)) return auth;

  const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";
  const status = req.nextUrl.searchParams.get("status")?.trim();

  const tickets = await prisma.ticket.findMany({
    where: {
      agentId: auth.userId,
      ...(status ? { status } : {}),
      ...(search
        ? { publicId: { contains: search, mode: "insensitive" as const } }
        : {}),
    },
    include: { bets: { select: { id: true, betAmount: true, winAmount: true, settled: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ tickets });
}

/**
 * POST — open a ticket draft. While one is OPEN, every BET transaction the
 * wallet callback writes for this agent attaches to it automatically.
 * One open draft per agent — a second open is rejected so bets can't leak
 * across customers.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInPersonAgent();
  if (isAgentAuthError(auth)) return auth;

  const ticket = await prisma.$transaction(async (tx) => {
    const open = await tx.ticket.findFirst({
      where: { agentId: auth.userId, status: "OPEN" },
      select: { id: true, publicId: true },
    });
    if (open) return { conflict: open };

    const publicId = await generateTicketCode(tx);
    const created = await tx.ticket.create({
      data: { publicId, agentId: auth.userId },
    });
    return { created };
  });

  if ("conflict" in ticket) {
    return NextResponse.json(
      { error: "Finish or cancel the open ticket first", ticket: ticket.conflict },
      { status: 409 }
    );
  }
  return NextResponse.json({ ticket: ticket.created }, { status: 201 });
}
