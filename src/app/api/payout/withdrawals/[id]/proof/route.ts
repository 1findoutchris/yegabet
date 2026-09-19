import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayoutAuth } from "@/lib/payoutAuth";
import { saveWithdrawalProof } from "@/lib/withdrawals";

/**
 * A payout agent attaches the payment proof for a request routed to them —
 * the screenshot the player sees as evidence the transfer went out.
 *
 * Same storage, key and 2-day lifetime as the admin upload (both go through
 * saveWithdrawalProof), so the player's view can't tell the difference.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const w = await prisma.withdrawalRequest.findUnique({
    where: { id },
    select: { id: true, status: true, withdrawalAgentId: true },
  });
  if (!w) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Same rule as every other agent action: only what was routed to them.
  if (w.withdrawalAgentId !== auth.agentId) {
    return NextResponse.json({ error: "Not assigned to you" }, { status: 403 });
  }

  // PENDING means they haven't pressed Process, so the player could still
  // cancel — a proof for a transfer that shouldn't have been sent yet would be
  // worse than none. REJECTED/CANCELLED have no payment to evidence.
  if (w.status !== "PROCESSING" && w.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Press Process first — attach the proof once the transfer is under way" },
      { status: 409 },
    );
  }

  const form = await req.formData().catch(() => null);
  const result = await saveWithdrawalProof(id, form?.get("file"));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ success: true });
}
