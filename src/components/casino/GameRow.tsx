"use client";

import { GameCarousel } from "@/components/vinna/GameCarousel";
import type { GameBadge } from "./GameCard";
import type { Game } from "@/types/games";

/* Kept for existing call sites (My Casino, Games page): the VinnaBet carousel
   under the old props. `icon` and `accentColor` belonged to the old header
   style and are ignored. */
interface GameRowProps {
  title: string;
  icon?: React.ReactNode;
  games: Game[];
  viewAllHref?: string;
  accentColor?: string;
  badge?: GameBadge;
  mobileGrid?: boolean;
  description?: string;
}

export function GameRow({ title, games, viewAllHref, badge, mobileGrid = false, description }: GameRowProps) {
  return (
    <GameCarousel title={title} description={description} games={games} href={viewAllHref} tag={badge} grid={mobileGrid} />
  );
}
