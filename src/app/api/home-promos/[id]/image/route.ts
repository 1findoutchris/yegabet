import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/storage";

// Public: a homepage promotion's image. Each upload gets a new storage key and
// the URL carries ?v=, so a long cache is safe. Same pattern as ad images.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const variant = req.nextUrl.searchParams.get("variant") === "mobile" ? "mobile" : "desktop";
  const p = await prisma.homePromo.findUnique({ where: { id }, select: { imageKey: true, mobileImageKey: true } });
  const key = variant === "mobile" ? p?.mobileImageKey : p?.imageKey;
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const obj = await getObject(key);
  if (!obj) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(obj.body), {
    headers: { "Content-Type": obj.contentType, "Cache-Control": "public, max-age=86400" },
  });
}
