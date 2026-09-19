import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { verifyAdminSession, ADMIN_COOKIE } from "./adminSession";

export function verifyAdminSecret(secret: string): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return false;
  return secret === expected;
}

export function adminUnauthorized() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Verify both the URL secret header and the session cookie. */
export async function requireAdminAuth(req: NextRequest): Promise<null | NextResponse> {
  const secret = req.headers.get("x-admin-secret") ?? "";
  if (!verifyAdminSecret(secret)) return adminUnauthorized();

  const token = req.cookies.get(ADMIN_COOKIE)?.value ?? "";
  const username = await verifyAdminSession(token);
  if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return null; // null = auth passed
}

export async function logAdminAction(opts: {
  action: string;
  targetId?: string;
  targetType?: string;
  note?: string;
  ipAddress?: string;
  metadata?: object;
}) {
  await prisma.adminLog.create({ data: opts }).catch(() => {});
}

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
