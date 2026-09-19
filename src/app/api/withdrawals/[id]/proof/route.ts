import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getObject, deleteObject } from "@/lib/storage";

// Serve a withdrawal's payment proof to its owner. Past the 2-day expiry the
// object is deleted from the bucket and 404s (lazy cleanup; the cron sweeps the rest).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const w = await prisma.withdrawalRequest.findFirst({
    where: { id, userId: session.user.id },
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
