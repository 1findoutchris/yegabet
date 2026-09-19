// Pure ad helpers shared by the client popup and the self-check. Kept out of
// ads.ts because that one is server-only (mirrors rewardConfigCore).

/** Expiry stamp for a YYYY-MM-DD input: the ad runs through the end of that day. */
export function parseExpiry(day: string): Date {
  return new Date(`${day}T23:59:59.999Z`);
}

/**
 * Index of the carousel slide nearest a scroll position. `offsets` are slide
 * positions relative to the first slide, so this stays correct whatever the
 * track's padding and gap are.
 */
export function nearestIndex(offsets: number[], scrollLeft: number): number {
  let best = 0;
  for (let i = 1; i < offsets.length; i++) {
    if (Math.abs(offsets[i] - scrollLeft) < Math.abs(offsets[best] - scrollLeft)) best = i;
  }
  return best;
}

/**
 * First ad the device hasn't already dismissed today. `seen` is the stored
 * `${id}:${YYYY-MM-DD}` marker, so a new day — or a different ad — shows again.
 */
export function pickUnseenAd<T extends { id: string }>(
  ads: T[],
  seen: string | null,
  today: string,
): T | null {
  return ads.find((a) => seen !== `${a.id}:${today}`) ?? null;
}
