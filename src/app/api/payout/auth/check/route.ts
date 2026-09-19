import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayoutAuth } from "@/lib/payoutAuth";

/** Session probe for the portal layout — 200 when signed in, 401/404 otherwise. */
export async function GET(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const agent = await prisma.withdrawalAgent.findUnique({
    where: { id: auth.agentId },
    select: { name: true, username: true, isCashAgent: true },
  });
  return NextResponse.json({
    name: agent?.name ?? agent?.username ?? "Agent",
    // Drives whether the portal shows the counter-deposit screen. The API
    // enforces it independently — this only hides a link.
    isCashAgent: agent?.isCashAgent ?? false,
  });
}
