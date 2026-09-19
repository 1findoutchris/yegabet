import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { verifyPayoutSession, PAYOUT_COOKIE } from "./payoutSession";

export interface PayoutAuth {
  agentId: string;
  /** Methods this agent may process — the queue is filtered to these. */
  methods: string[];
  commissionRate: number;
  slaMinutes: number;
}

/** The secret URL prefix gating the payout portal (mirrors ADMIN/AGENT_SECRET). */
export function verifyPayoutSecret(secret: string): boolean {
  const expected = process.env.PAYOUT_SECRET;
  if (!expected) return false;
  return secret === expected;
}

/**
 * Resolve the logged-in payout agent. Requires BOTH the `x-payout-secret`
 * header and a valid session cookie:
 *   - bad/missing secret → 404 (the portal stays hidden)
 *   - bad/missing session, or a disabled agent → 401
 */
export async function requirePayoutAuth(
  req: NextRequest,
): Promise<PayoutAuth | NextResponse> {
  const secret = req.headers.get("x-payout-secret") ?? "";
  if (!verifyPayoutSecret(secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = req.cookies.get(PAYOUT_COOKIE)?.value ?? "";
  const agentId = await verifyPayoutSession(token);
  if (!agentId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agent = await prisma.withdrawalAgent.findUnique({
    where: { id: agentId },
    select: { id: true, methods: true, commissionRate: true, slaMinutes: true, isActive: true },
  });
  if (!agent || !agent.isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return {
    agentId: agent.id,
    methods: agent.methods,
    commissionRate: Number(agent.commissionRate),
    slaMinutes: agent.slaMinutes,
  };
}
