"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OCTHERA_ID_PREFIX, type Game } from "@/types/games";

/** The site's own player page for an Octhera game (/game/[id]). */
export const gamePagePath = (gameID: string) =>
  `/game/${encodeURIComponent(gameID.slice(OCTHERA_ID_PREFIX.length))}`;

interface GamePlayerContextType {
  open: (game: Game) => void;
  close: () => void;
  current: Game | null;
  gameUrl: string | null;
  status: "idle" | "loading" | "ready";
}

const GamePlayerContext = createContext<GamePlayerContextType>({
  open: () => {},
  close: () => {},
  current: null,
  gameUrl: null,
  status: "idle",
});

export function GamePlayerProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<Game | null>(null);
  const [gameUrl, setGameUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready">("idle");
  const router = useRouter();

  const open = useCallback(async (game: Game) => {
    // Octhera games play on their own page, inside the site, in an iframe.
    // That page asks /api/games/launch for the launch URL itself.
    if (game.gameID.startsWith(OCTHERA_ID_PREFIX)) {
      router.push(gamePagePath(game.gameID));
      return;
    }

    setCurrent(game);
    setGameUrl(null);
    setStatus("loading");

    try {
      const res = await fetch("/api/games/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_uid: game.gameID }),
      });

      const data = await res.json();

      if (!res.ok || !data.game_launch_url) {
        // Close overlay and show toast — no full-screen error state
        setCurrent(null);
        setStatus("idle");
        if (data.unavailable) {
          toast.error(`${game.gameNameEn} is unavailable`, {
            description: "This game can't be opened right now — please try another.",
          });
        } else {
          toast.error(`Failed to open ${game.gameNameEn}`, {
            description: data.error ?? "Please try again in a moment",
          });
        }
        return;
      }

      setGameUrl(data.game_launch_url);
      setStatus("ready");
    } catch {
      setCurrent(null);
      setStatus("idle");
      toast.error(`Failed to open ${game.gameNameEn}`, {
        description: "Network error — check your connection and try again",
      });
    }
  }, [router]);

  const close = useCallback(() => {
    setCurrent(null);
    setGameUrl(null);
    setStatus("idle");
  }, []);

  return (
    <GamePlayerContext.Provider value={{ open, close, current, gameUrl, status }}>
      {children}
    </GamePlayerContext.Provider>
  );
}

export const useGamePlayer = () => useContext(GamePlayerContext);
