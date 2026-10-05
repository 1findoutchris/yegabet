import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { launchGame, GameUnavailableError } from "@/lib/providers/silent-api";
import { openGame, GregmornError } from "@/lib/providers/gregmorn";
import { SPORTSBOOK_GAME_UID, OCTHERA_AVIATOR_ID, OCTHERA_ID_PREFIX } from "@/types/games";
import { catalogMode, getGamesByIds, loadGames, loadOctheraPage } from "@/lib/games";
import { OctheraError, aviatorGameUid, launchGame as launchOcthera } from "@/lib/providers/octhera";
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

    // The site's catalog is Octhera's (lib/catalog). The old provider's games
    // are off the site; only its sportsbook still launches here — the
    // sportsbook (Sports pane, agents' tickets) is unchanged.
    // GAME_CATALOG=legacy puts the old catalog back.
    if (catalogMode() === "octhera" && !game_uid.startsWith(OCTHERA_ID_PREFIX) && game_uid !== SPORTSBOOK_GAME_UID) {
      return NextResponse.json(
        { error: "This game is no longer available", unavailable: true },
        { status: 410 }
      );
    }

    // Octhera games (Aviator, and the whole Octhera catalog), whatever
    // GAME_PROVIDER is. API v2 company wallet: they play with the normal
    // VinnaBet balance — Octhera calls /api/provider/octhera/wallet for every
    // bet and win. The site's /game/[id] page loads the URL in an iframe.
    if (game_uid.startsWith(OCTHERA_ID_PREFIX)) {
      const unavailable = () =>
        NextResponse.json({ error: "This game is temporarily unavailable", unavailable: true }, { status: 502 });
      let resolveUid = aviatorGameUid;
      if (game_uid === OCTHERA_AVIATOR_ID) {
        if (process.env.OCTHERA_AVIATOR_PUBLIC !== "true") return unavailable();
      } else if (catalogMode() === "octhera") {
        // Any game on the site: an active row of the imported catalog.
        await loadGames();
        if (!getGamesByIds([game_uid]).length) return unavailable();
        resolveUid = async () => game_uid.slice(OCTHERA_ID_PREFIX.length);
      } else {
        // Legacy catalog: any game in Octhera's catalog (shown on /octhera, and
        // in the normal lists while OCTHERA_GAMES_PUBLIC=true) — nothing outside it.
        const { games } = await loadOctheraPage();
        if (!games.some((g) => g.gameID === game_uid)) return unavailable();
        resolveUid = async () => game_uid.slice(OCTHERA_ID_PREFIX.length);
      }
      const device = /Mobi|Android|iPhone|iPad/i.test(req.headers.get("user-agent") ?? "") ? "mobile" : "desktop";
      const url = await launchOcthera({
        playerId: session.user.id,
        balance: Number(user.balance),
        gameUid: await resolveUid(),
        device,
      });
      try {
        await prisma.recentGame.upsert({
          where: { userId_gameId: { userId: session.user.id, gameId: game_uid } },
          create: { userId: session.user.id, gameId: game_uid },
          update: { playCount: { increment: 1 }, lastPlayedAt: new Date() },
        });
      } catch (e) {
        console.error("[games/launch] recent upsert failed", e);
      }
      return NextResponse.json({ game_launch_url: url });
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
