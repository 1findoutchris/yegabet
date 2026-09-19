import { NextRequest, NextResponse } from "next/server";
import { deleteAdminSession, ADMIN_COOKIE } from "@/lib/adminSession";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (token) await deleteAdminSession(token);

  const res = NextResponse.json({ success: true });
  res.cookies.set(ADMIN_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
