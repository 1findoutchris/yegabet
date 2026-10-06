import { NextRequest, NextResponse } from "next/server";
import { versionPolicy } from "@/lib/appVersion";

// GET /api/app/version?platform=ios|android — the native app's update policy
// (lib/appVersion). Public: the app checks it before anyone signs in.
export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform");
  if (platform !== "ios" && platform !== "android") {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }
  return NextResponse.json(versionPolicy(platform), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
