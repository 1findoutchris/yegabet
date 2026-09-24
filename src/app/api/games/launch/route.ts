import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { launchGame, GameUnavailableError } from "@/lib/providers/silent-api";
import { openGame, GregmornError } from "@/lib/providers/gregmorn";
import { SPORTSBOOK_GAME_UID } from "@/types/games";
import { z } from "zod";

const launchSchema = z.object({
  game_uid: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { game_uid } = launchSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { balance: true, username: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Provider switch: unset/anything-else keeps Silent as the default so
    // nothing changes until GAME_PROVIDER=gregmorn is deployed.
    if (process.env.GAME_PROVIDER === "gregmorn") {
      const result = await openGame({
        gameId: game_uid,
        playerLogin: session.user.id, // echoed back as `login` in callbacks
        exitUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      });

      // Their callbacks carry only `login` + `sessionid` — persist the session
      // so getBalance/writeBet can validate it.
      if (result.sessionId) {
        try {
          await prisma.gameSession.create({
            data: { sessionId: result.sessionId, userId: session.user.id, gameId: game_uid },
          });
        } catch (e) {
          console.error("[games/launch] session persist failed", e);
        }
      }

      if (game_uid !== SPORTSBOOK_GAME_UID) {
        try {
          await prisma.recentGame.upsert({
            where: { userId_gameId: { userId: session.user.id, gameId: game_uid } },
            create: { userId: session.user.id, gameId: game_uid },
            update: { playCount: { increment: 1 }, lastPlayedAt: new Date() },
          });
        } catch (e) {
          console.error("[games/launch] recent upsert failed", e);
        }
      }

      return NextResponse.json({ game_launch_url: result.url });
    }

    const result = await launchGame({
      member_account: user.username,
      game_uid,
      balance: Number(user.balance),
      home_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    });

    // Record the play for "Continue playing" — best-effort, never blocks launch.
    // The sportsbook isn't a casino game, so it's excluded.
    if (game_uid !== SPORTSBOOK_GAME_UID) {
      try {
        await prisma.recentGame.upsert({
          where: { userId_gameId: { userId: session.user.id, gameId: game_uid } },
          create: { userId: session.user.id, gameId: game_uid },
          update: { playCount: { increment: 1 }, lastPlayedAt: new Date() },
        });
      } catch (e) {
        console.error("[games/launch] recent upsert failed", e);
      }
    }

    return NextResponse.json({ game_launch_url: result.payload.game_launch_url });
  } catch (error) {
    if (error instanceof GregmornError) {
      console.warn("[games/launch] gregmorn unavailable:", error.status, error.providerMessage);
      return NextResponse.json(
        { error: "This game is temporarily unavailable", unavailable: true },
        { status: 502 }
      );
    }
    if (error instanceof GameUnavailableError) {
      // Provider declined (e.g. vendor not authorized) — not our bug.
      console.warn("[games/launch] provider unavailable:", error.providerMessage);
      return NextResponse.json(
        { error: "This game is temporarily unavailable", unavailable: true },
        { status: 502 }
      );
    }
    console.error("[games/launch]", error);
    return NextResponse.json({ error: "Failed to launch game" }, { status: 500 });
  }
}
