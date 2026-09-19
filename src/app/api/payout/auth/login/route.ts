import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyPayoutSecret } from "@/lib/payoutAuth";
import { createPayoutSession, PAYOUT_COOKIE } from "@/lib/payoutSession";
import { z } from "zod";

const schema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  // Portal stays hidden behind the secret URL, same as admin and cashier agents.
  if (!verifyPayoutSecret(req.headers.get("x-payout-secret") ?? "")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { username, password } = parsed.data;

  const agent = await prisma.withdrawalAgent.findUnique({
    where: { username },
    select: { id: true, passwordHash: true, isActive: true },
  });

  // One message for every failure mode so the response can't be used to probe
  // which usernames exist.
  if (!agent || !agent.isActive || !(await bcrypt.compare(password, agent.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createPayoutSession(agent.id);
  const res = NextResponse.json({ success: true });
  res.cookies.set(PAYOUT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return res;
}
