import type { Metadata } from "next";
import { OctheraPlayer } from "@/components/casino/OctheraPlayer";
import { catalogMode, getGamesByIds, loadGames, loadOctheraPage } from "@/lib/games";
import { OCTHERA_ID_PREFIX, PROVIDER_META, type Game } from "@/types/games";

interface Props {
  params: Promise<{ id: string }>;
}

/** The Octhera gameUid from the URL segment (gamePagePath encodes it). */
function gameUid(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The catalog entry behind /game/[id] (id = the Octhera gameUid), if any. */
async function findGame(id: string): Promise<Game | null> {
  const gameID = OCTHERA_ID_PREFIX + id;
  await loadGames();
  const [game] = getGamesByIds([gameID]);
  if (game || catalogMode() === "octhera") return game ?? null;
  const { games } = await loadOctheraPage();
  return games.find((g) => g.gameID === gameID) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const game = await findGame(gameUid((await params).id));
  return { title: game?.gameNameEn ?? "Play", robots: { index: false } };
}

/*
 * /game/[id] — an Octhera game, played inside the site: the header stays, and
 * the game runs in an iframe below it. The launch URL is single-use and made
 * on the server per player, so the player component asks /api/games/launch
 * for it when the page opens; nothing about it is in this page's HTML.
 * An unknown id still renders: the launch call says the game is unavailable.
 */
export default async function GamePage({ params }: Props) {
  const id = gameUid((await params).id);
  const game = await findGame(id);
  const providerName = game
    ? (PROVIDER_META[game.provider]?.name ?? game.providerName ?? game.provider)
    : null;

  return (
    <OctheraPlayer
      gameID={OCTHERA_ID_PREFIX + id}
      name={game?.gameNameEn ?? null}
      providerName={providerName}
    />
  );
}
