import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { putObject, deleteObject, storageConfigured } from "@/lib/storage";
import { parseExpiry } from "@/lib/adsCore";
import { z } from "zod";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — banners, not wallpapers

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  // Same order the players see, so the admin list is a preview of the carousel.
  const ads = await prisma.ad.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({
    ads: ads.map((a) => ({
      id: a.id,
      placement: a.placement,
      linkUrl: a.linkUrl ?? "",
      expiresAt: a.expiresAt.toISOString().slice(0, 10),
      isActive: a.isActive,
      sortOrder: a.sortOrder,
      expired: a.expiresAt <= new Date(),
      imageUrl: `/api/promos/${a.id}/image?v=${a.updatedAt.getTime()}`,
    })),
  });
}

// Create — multipart, because the image comes with it.
export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;
  if (!storageConfigured()) return NextResponse.json({ error: "Storage not configured" }, { status: 500 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const placement = String(form?.get("placement") ?? "");
  const expires = String(form?.get("expiresAt") ?? "");
  const linkUrl = String(form?.get("linkUrl") ?? "").trim();

  if (placement !== "BOARD" && placement !== "POPUP") {
    return NextResponse.json({ error: "Placement must be BOARD or POPUP" }, { status: 400 });
  }
  // End of the chosen day, so "expires 6 Aug" means it runs through the 6th.
  const expiresAt = parseExpiry(expires);
  if (isNaN(expiresAt.getTime())) return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
  if (linkUrl && !/^https?:\/\//i.test(linkUrl)) {
    return NextResponse.json({ error: "Link must start with http:// or https://" }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "No image" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Must be an image" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 400 });

  const ad = await prisma.ad.create({
    data: { placement, imageKey: "", linkUrl: linkUrl || null, expiresAt },
  });
  const key = `ads/${ad.id}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  await prisma.ad.update({ where: { id: ad.id }, data: { imageKey: key } });

  await logAdminAction({
    action: "CREATE_AD",
    targetId: ad.id,
    targetType: "Ad",
    note: `${placement} until ${expires}`,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ success: true });
}

// Edit an ad. Every field is optional, so the same route serves a full row save
// and the one-field pause/resume toggle.
const patchSchema = z.object({
  id: z.string().min(1),
  placement: z.enum(["BOARD", "POPUP"]).optional(),
  // Empty string clears the click-through, which is why this isn't a url().
  linkUrl: z.string().trim().max(500).optional(),
  expiresAt: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export async function PATCH(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { id, expiresAt: expires, linkUrl, ...rest } = parsed.data;

  if (linkUrl && !/^https?:\/\//i.test(linkUrl)) {
    return NextResponse.json({ error: "Link must start with http:// or https://" }, { status: 400 });
  }

  let expiresAt: Date | undefined;
  if (expires !== undefined) {
    expiresAt = parseExpiry(expires);
    if (isNaN(expiresAt.getTime())) {
      return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
    }
  }

  const updated = await prisma.ad.updateMany({
    where: { id },
    data: {
      ...rest,
      ...(expiresAt ? { expiresAt } : {}),
      // Blank clears it; absent leaves it alone.
      ...(linkUrl !== undefined ? { linkUrl: linkUrl || null } : {}),
    },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await logAdminAction({
    action: "UPDATE_AD",
    targetId: id,
    targetType: "Ad",
    ipAddress: getClientIp(req),
    metadata: parsed.data,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const ad = await prisma.ad.findUnique({ where: { id } });
  if (!ad) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deleteObject(ad.imageKey);
  await prisma.ad.delete({ where: { id } });
  await logAdminAction({ action: "DELETE_AD", targetId: id, targetType: "Ad", ipAddress: getClientIp(req) });

  return NextResponse.json({ success: true });
}
