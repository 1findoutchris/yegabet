import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { launchGame, GameUnavailableError } from "@/lib/providers/silent-api";
import { openGame, GregmornError } from "@/lib/providers/gregmorn";
import { SPORTSBOOK_GAME_UID, OCTHERA_AVIATOR_ID, OCTHERA_ID_PREFIX } from "@/types/games";
import { loadOctheraPage } from "@/lib/games";
import {
  OctheraError, aviatorGameUid, ensurePlayer, getBalance, launchGame as launchOcthera, octheraUsername,
} from "@/lib/providers/octhera";
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

    // Octhera games (Aviator, and the whole Octhera catalog) — their own
    // aggregator and their own per-player wallet (funded by hand in the
    // Octhera portal), whatever GAME_PROVIDER is.
    if (game_uid.startsWith(OCTHERA_ID_PREFIX)) {
      const unavailable = () =>
        NextResponse.json({ error: "This game is temporarily unavailable", unavailable: true }, { status: 502 });
      let name = "Aviator";
      let resolveUid = aviatorGameUid;
      if (game_uid === OCTHERA_AVIATOR_ID) {
        if (process.env.OCTHERA_AVIATOR_PUBLIC !== "true") return unavailable();
      } else {
        // Any game in Octhera's catalog (shown on /octhera, and in the normal
        // lists while OCTHERA_GAMES_PUBLIC=true) — nothing outside it.
        const { games } = await loadOctheraPage();
        const game = games.find((g) => g.gameID === game_uid);
        if (!game) return unavailable();
        name = game.gameNameEn;
        resolveUid = async () => game_uid.slice(OCTHERA_ID_PREFIX.length);
      }
      const username = octheraUsername(session.user.id);
      await ensurePlayer(username);
      const device = /Mobi|Android|iPhone|iPad/i.test(req.headers.get("user-agent") ?? "") ? "mobile" : "desktop";
      const url = await launchOcthera({ username, gameUid: await resolveUid(), device });
      // Tell the player which balance the game plays with — it isn't their VinnaBet balance.
      const wallet = await getBalance(username).catch(() => null);
      const notice = wallet
        ? wallet.balance > 0
          ? `${name} balance: ${wallet.balance.toFixed(2)} ${wallet.currency} (separate from your VinnaBet balance)`
          : `Your ${name} balance is 0 ETB — it's separate from your VinnaBet balance. Contact support to add funds.`
        : null;
      try {
        await prisma.recentGame.upsert({
          where: { userId_gameId: { userId: session.user.id, gameId: game_uid } },
          create: { userId: session.user.id, gameId: game_uid },
          update: { playCount: { increment: 1 }, lastPlayedAt: new Date() },
        });
      } catch (e) {
        console.error("[games/launch] recent upsert failed", e);
      }
      return NextResponse.json({ game_launch_url: url, notice });
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
    if (error instanceof OctheraError) {
      console.warn("[games/launch] octhera unavailable:", error.status, error.providerMessage);
      return NextResponse.json(
        { error: "This game is temporarily unavailable", unavailable: true },
        { status: 502 }
      );
    }
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
