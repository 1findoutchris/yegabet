import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  current: z.string().min(1, "Enter your current password"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

/**
 * Change your own password while signed in.
 *
 * The forgotten-password path is /api/auth/password/reset, which proves control
 * of the phone by SMS OTP. This one proves it by knowing the current password,
 * so a walked-away session can't be used to lock the real owner out.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { current, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
    return NextResponse.json({ error: "Your current password is incorrect." }, { status: 400 });
  }

  if (await bcrypt.compare(password, user.passwordHash)) {
    return NextResponse.json({ error: "That's already your password." }, { status: 400 });
  }

  // Cost 12, matching register and reset — a cheaper hash here would quietly
  // weaken every account that ever changes its password.
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: await bcrypt.hash(password, 12) },
  });

  return NextResponse.json({ success: true });
}
