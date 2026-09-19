import { NextRequest, NextResponse } from "next/server";
import { verifyAdminSession, ADMIN_COOKIE } from "@/lib/adminSession";
import { verifyAdminSecret } from "@/lib/adminAuth";

export async function GET(req: NextRequest) {
  // URL secret check
  const secret = req.headers.get("x-admin-secret") ?? "";
  if (!verifyAdminSecret(secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = req.cookies.get(ADMIN_COOKIE)?.value ?? "";
  const username = await verifyAdminSession(token);

  if (!username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ username });
}
