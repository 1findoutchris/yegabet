import "server-only";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

export type Placement = "BOARD" | "POPUP";

export interface Ad {
  id: string;
  imageUrl: string;
  linkUrl: string | null;
}

/** Live ads for a placement: active and not past their expiry date. */
export async function getActiveAds(placement: Placement): Promise<Ad[]> {
  // Keeps this query out of prerendering — otherwise a static page that shows
  // ads (e.g. /games) tries to reach the DB during `next build`, where there is
  // no DATABASE_URL. Also correct on its own terms: ad liveness is time-based,
  // so a build-time snapshot would be stale.
  await connection();

  const rows = await prisma.ad.findMany({
    where: { placement, isActive: true, expiresAt: { gt: new Date() } },
    // Admin-set order first; newest-first only breaks ties, which is how this
    // behaved before sortOrder existed.
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true, linkUrl: true, updatedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    // ?v= busts the image route's day-long cache when an admin swaps the file.
    imageUrl: `/api/promos/${r.id}/image?v=${r.updatedAt.getTime()}`,
    linkUrl: r.linkUrl,
  }));
}
