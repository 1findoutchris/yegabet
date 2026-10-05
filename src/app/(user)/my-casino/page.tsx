import { Sparkles, Heart, Flame } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getGamesByIds, getRecommendedFrom, getLiveCasinoGames, loadGames,
} from "@/lib/games";
import { effectiveStreak } from "@/lib/loyalty";
import { getRewardConfig } from "@/lib/rewardConfig";
import { SPORTSBOOK_GAME_UID } from "@/types/games";
import { MyCasino, type MyCasinoStats } from "@/components/casino/MyCasino";
import { SearchTrigger }    from "@/components/vinna/SearchTrigger";
import { LoginRequired } from "@/components/auth/LoginRequired";
import { GameRow }       from "@/components/casino/GameRow";
import { RewardProgress } from "@/components/vinna/RewardProgress";
import { ChallengeCard } from "@/components/retention/ChallengeCard";
import type { Game } from "@/types/games";

export default async function MyCasinoPage() {
  const session = await auth();
  const userId = session?.user?.id;

  // Every panel below is this player's own history — logged out it rendered as
  // a wall of zeroes, which reads as "you have nothing" rather than "log in".
  if (!userId) {
    return (
      <LoginRequired
        title="My Casino"
        message="Log in to see your recent games, favourites, big wins and rewards."
      />
    );
  }

  let recent: Game[] = [];
  let favorites: Game[] = [];
  let stats: MyCasinoStats = { totalWagered: 0, biggestWin: 0, streakDays: 0, points: 0 };
  // The game where the biggest win actually happened (from the top WIN txn),
  // NOT the most recent game — otherwise the card changes on every play.
  let bigWin: Game | null = null;

  if (userId) {
    await loadGames();
    const [recentRows, favRows, betAgg, topWin, user] = await Promise.all([
      prisma.recentGame.findMany({
        where: { userId }, orderBy: { lastPlayedAt: "desc" }, take: 12, select: { gameId: true },
      }),
      prisma.favoriteGame.findMany({
        where: { userId }, orderBy: { createdAt: "desc" }, take: 24, select: { gameId: true },
      }),
      prisma.transaction.aggregate({ where: { userId, type: "BET" }, _sum: { amount: true } }),
      prisma.transaction.findFirst({
        where: { userId, type: "WIN" }, orderBy: { amount: "desc" },
        select: { amount: true, metadata: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { streakDays: true, lastSeenAt: true, loyaltyPoints: true } }),
    ]);

    recent = getGamesByIds(
      recentRows.map((r) => r.gameId).filter((id) => id !== SPORTSBOOK_GAME_UID)
    );
    favorites = getGamesByIds(favRows.map((r) => r.gameId));
    stats = {
      totalWagered: Number(betAgg._sum.amount ?? 0),
      biggestWin: Number(topWin?.amount ?? 0),
      streakDays: effectiveStreak(user?.streakDays ?? 0, user?.lastSeenAt ?? null),
      points: user?.loyaltyPoints ?? 0,
    };

    // Resolve the game of the biggest win from the callback payload stored on the txn.
    const winGameId = topWin?.metadata && typeof topWin.metadata === "object"
      ? (topWin.metadata as { game_uid?: string }).game_uid : undefined;
    if (winGameId && winGameId !== SPORTSBOOK_GAME_UID) {
      bigWin = getGamesByIds([winGameId])[0] ?? null;
    }
  }

  // Recommendations seeded from what you've actually played (excluding those).
  const recentIds = recent.map((g) => g.gameID);
  const recommended = getRecommendedFrom(recentIds, recentIds, 18);

  // Generic live suggestions to round out the hub.
  const live = getLiveCasinoGames(20);
  const { tiers } = await getRewardConfig();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 flex flex-col gap-9 pb-16">
      <MyCasino recent={recent} bigWin={bigWin} stats={stats} tiers={tiers} />

      <SearchTrigger />

      {recommended.length > 0 && (
        <GameRow title="Recommended for you" icon={<Sparkles className="w-[18px] h-[18px]" />}
          games={recommended} viewAllHref="/casino/hot" />
      )}

      {favorites.length > 0 && (
        <GameRow title="Your favorites" icon={<Heart className="w-[18px] h-[18px]" />}
          games={favorites} viewAllHref="/casino/slots" />
      )}

      {live.length > 0 && (
        <GameRow title="Jump back into live" icon={<Flame className="w-[18px] h-[18px]" />}
          games={live} viewAllHref="/casino/live" badge="live" />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RewardProgress points={stats.points} tiers={tiers} />
        <ChallengeCard />
      </div>
    </div>
  );
}
