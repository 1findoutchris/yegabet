import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/storage";

// Public: serve a prize image from object storage. Mirrors /api/promos/[id]/image.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prize = await prisma.spinPrize.findUnique({ where: { id }, select: { imageKey: true } });
  if (!prize?.imageKey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const obj = await getObject(prize.imageKey);
  if (!obj) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(Buffer.from(obj.body), {
    headers: {
      "Content-Type": obj.contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
