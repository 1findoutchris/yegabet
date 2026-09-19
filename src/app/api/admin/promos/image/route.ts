import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { putObject, storageConfigured } from "@/lib/storage";

// Replace an existing ad's image. Separate from the main /api/admin/ads route
// because PATCH there is JSON and can't carry a file, and POST there creates a
// new ad. Mirrors /api/admin/spin/image.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;
  if (!storageConfigured()) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const ad = await prisma.ad.findUnique({ where: { id }, select: { id: true, placement: true } });
  if (!ad) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Must be an image" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 400 });

  // Fixed key per ad, so a re-upload overwrites rather than orphaning the old
  // object. Touching the row bumps `updatedAt`, which is what cache-busts the
  // day-long Cache-Control on the public image route.
  const key = `ads/${ad.id}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  await prisma.ad.update({ where: { id: ad.id }, data: { imageKey: key } });

  await logAdminAction({
    action: "UPLOAD_AD_IMAGE",
    targetId: ad.id,
    targetType: "Ad",
    note: ad.placement,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ success: true });
}
