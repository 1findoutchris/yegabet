import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/storage";

// Public: serve an ad image from object storage. Mirrors api/rewards/badge.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ad = await prisma.ad.findUnique({ where: { id }, select: { imageKey: true } });
  if (!ad) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const obj = await getObject(ad.imageKey);
  if (!obj) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(Buffer.from(obj.body), {
    headers: {
      "Content-Type": obj.contentType,
      // Key is immutable per ad row, so a long cache is safe.
      "Cache-Control": "public, max-age=86400",
    },
  });
}
