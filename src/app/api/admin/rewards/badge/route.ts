import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { putObject, storageConfigured } from "@/lib/storage";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — badges are small icons

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// Upload a tier/achievement badge image. Returns the URL to store in the badge
// field. Mirrors the agent-photo upload (see api/admin/agents/[id]/photo).
export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;
  if (!storageConfigured()) return NextResponse.json({ error: "Storage not configured" }, { status: 500 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const slug = slugify(String(form?.get("slug") ?? ""));
  if (!slug) return NextResponse.json({ error: "Missing or invalid slug" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Must be an image" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be under 2 MB" }, { status: 400 });

  const key = `badges/${slug}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await putObject(key, buf, file.type);

  await logAdminAction({
    action: "UPLOAD_REWARD_BADGE",
    targetId: slug,
    targetType: "RewardBadge",
    ipAddress: getClientIp(req),
  });

  // Cache-bust so a re-upload under the same slug refreshes in the UI.
  return NextResponse.json({ success: true, url: `/api/rewards/badge/${slug}?v=${Date.now()}` });
}
