import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withdrawable } from "@/lib/wallet";

// GET — the player's wallet split across the three pots.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { balance: true, depositBalance: true, bonusBalance: true },
  });

  const wallet = {
    balance: Number(user?.balance ?? 0),
    depositBalance: Number(user?.depositBalance ?? 0),
    bonusBalance: Number(user?.bonusBalance ?? 0),
  };

  return NextResponse.json({
    ...wallet,
    // Bonus and deposit funds are playable but locked to the site; only
    // winnings can be cashed out.
    withdrawable: withdrawable(wallet),
  });
}
