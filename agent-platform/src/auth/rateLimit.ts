import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Fixed-window rate limit kept in memory (CLAUDE.md §7: rate-limit auth).
 * Good for one replica; multiple replicas need a shared store (Task 16).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit for `key`; throws 429 once the limit is passed in the current window. */
  hit(key: string): void {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: t, count: 1 });
      if (this.hits.size > 50_000) this.sweep(t);
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      throw new HttpException("Too many attempts. Please wait a minute.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Forget expired windows so the map can't grow without bound. */
  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (t - v.windowStart >= this.windowMs) this.hits.delete(k);
  }
}
