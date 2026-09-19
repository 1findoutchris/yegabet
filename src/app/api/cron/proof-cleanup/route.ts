import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/storage";

// Delete expired withdrawal proofs from the bucket. Guarded by CRON_SECRET; wire
// a scheduler to hit it (e.g. hourly/daily). Serving also lazily deletes on
// access, but this guarantees cleanup for proofs no one views.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expired = await prisma.withdrawalRequest.findMany({
    where: { proofKey: { not: null }, proofExpiresAt: { lt: new Date() } },
    select: { id: true, proofKey: true },
  });

  for (const w of expired) {
    if (w.proofKey) await deleteObject(w.proofKey);
    await prisma.withdrawalRequest.update({ where: { id: w.id }, data: { proofKey: null, proofExpiresAt: null } });
  }

  return NextResponse.json({ deleted: expired.length });
}
