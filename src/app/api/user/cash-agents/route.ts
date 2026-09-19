import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Cash agents this player may withdraw through.
 *
 * Normally every active one. If they last deposited over a counter, it is just
 * that agent — the money went in there, so it comes back out there. That
 * binding is dropped the moment the agent is deactivated, which is what stops a
 * departed agent from freezing their whole customer base's balances.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { cashAgentId: true },
  });

  const agents = await prisma.withdrawalAgent.findMany({
    where: { isCashAgent: true, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, username: true, contactType: true, contactHandle: true },
  });

  const bound = user?.cashAgentId
    ? agents.find((a) => a.id === user.cashAgentId)
    : undefined;

  return NextResponse.json({
    lockedToAgentId: bound?.id ?? null,
    agents: (bound ? [bound] : agents).map((a) => ({
      id: a.id,
      name: a.name || a.username,
      contactType: a.contactType,
      contactHandle: a.contactHandle,
    })),
  });
}
