import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireInPersonAgent, isAgentAuthError } from "@/lib/agentAuth";
import { generateTicketCode } from "@/lib/tickets";

const createSchema = z.object({
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(7).max(20),
});

/**
 * GET — the agent's tickets, newest first. `?search=` matches the ticket code,
 * customer name, or customer phone (what the agent types when a customer
 * walks back in holding a ticket).
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
        ? {
            OR: [
              { publicId: { contains: search, mode: "insensitive" } },
              { customerName: { contains: search, mode: "insensitive" } },
              { customerPhone: { contains: search, mode: "insensitive" } },
            ],
          }
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

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Customer name and phone are required" }, { status: 400 });
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const open = await tx.ticket.findFirst({
      where: { agentId: auth.userId, status: "OPEN" },
      select: { id: true, publicId: true },
    });
    if (open) return { conflict: open };

    const publicId = await generateTicketCode(tx);
    const created = await tx.ticket.create({
      data: {
        publicId,
        agentId: auth.userId,
        customerName: parsed.data.customerName,
        customerPhone: parsed.data.customerPhone,
      },
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
