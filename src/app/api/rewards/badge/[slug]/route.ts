import { NextRequest, NextResponse } from "next/server";
import { getObject } from "@/lib/storage";

// Public: serve an uploaded reward badge from object storage.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!safe) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const obj = await getObject(`badges/${safe}`);
  if (!obj) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(Buffer.from(obj.body), {
    headers: {
      "Content-Type": obj.contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
