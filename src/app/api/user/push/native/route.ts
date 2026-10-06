import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const registerSchema = z.object({
  token: z.string().min(16).max(4096),
  platform: z.enum(["ios", "android"]),
});

// POST — store the native app's push token (APNs on iOS, FCM on Android) for
// the signed-in player. Upsert on token so a refresh, or the device switching
// accounts, moves the token instead of duplicating it.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const { token, platform } = parsed.data;
  const userId = session.user.id;
  await prisma.nativePushToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: { userId, platform },
  });

  return NextResponse.json({ ok: true });
}

// DELETE — forget a device token. No session needed: the app calls this right
// after sign-out so the next player on the phone doesn't get the last one's
// alerts, and holding the token is proof enough of being that device.
export async function DELETE(req: NextRequest) {
  const parsed = registerSchema.pick({ token: true }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }
  await prisma.nativePushToken.deleteMany({ where: { token: parsed.data.token } });
  return NextResponse.json({ ok: true });
}
