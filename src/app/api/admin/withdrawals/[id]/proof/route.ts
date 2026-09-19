import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { saveWithdrawalProof } from "@/lib/withdrawals";
import { getObject, deleteObject } from "@/lib/storage";

// Admin uploads a payment proof for a withdrawal. Shown to the user, then hidden
// and deleted from the bucket after 2 days (see the proof serve route + cron).
//
// Payout agents upload the same thing from their own portal — both go through
// saveWithdrawalProof, so the limits, lifetime and object key stay in step.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const w = await prisma.withdrawalRequest.findUnique({ where: { id }, select: { id: true } });
  if (!w) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const result = await saveWithdrawalProof(id, form?.get("file"));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await logAdminAction({ action: "UPLOAD_WITHDRAWAL_PROOF", targetId: id, targetType: "WithdrawalRequest", ipAddress: getClientIp(req) });
  return NextResponse.json({ success: true });
}

// Serve that proof back to an admin. The player-facing route next to this one
// scopes by session user, so it can't answer for staff looking at someone
// else's withdrawal — hence a second reader behind the admin guard.
//
// Same 2-day expiry and lazy delete as the player route: an admin opening an
// expired proof is as good a moment to sweep the object as any.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const w = await prisma.withdrawalRequest.findUnique({
    where: { id },
    select: { proofKey: true, proofExpiresAt: true },
  });
  if (!w?.proofKey) return new NextResponse(null, { status: 404 });

  if (w.proofExpiresAt && w.proofExpiresAt < new Date()) {
    await deleteObject(w.proofKey);
    await prisma.withdrawalRequest.update({ where: { id }, data: { proofKey: null, proofExpiresAt: null } });
    return new NextResponse(null, { status: 404 });
  }

  const obj = await getObject(w.proofKey);
  if (!obj) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(obj.body), {
    headers: { "Content-Type": obj.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
