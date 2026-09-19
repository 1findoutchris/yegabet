import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/adminAuth";
import { getObject } from "@/lib/storage";

/**
 * GET — stream a ticket's payout receipt to an admin. The agent uploads it
 * when marking a WON ticket PAID; stored as proofKey in S3 (same pattern as
 * withdrawal proofs).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { proofKey: true },
  });
  if (!ticket?.proofKey) return new NextResponse(null, { status: 404 });

  const obj = await getObject(ticket.proofKey);
  if (!obj) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(obj.body), {
    headers: { "Content-Type": obj.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
