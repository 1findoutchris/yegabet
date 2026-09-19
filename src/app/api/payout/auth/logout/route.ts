import { NextRequest, NextResponse } from "next/server";
import { deletePayoutSession, PAYOUT_COOKIE } from "@/lib/payoutSession";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(PAYOUT_COOKIE)?.value;
  if (token) await deletePayoutSession(token);

  const res = NextResponse.json({ success: true });
  res.cookies.set(PAYOUT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
