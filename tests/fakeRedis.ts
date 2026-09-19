import { EventEmitter } from "node:events";

/*
 * In-memory stand-in for src/lib/redis.ts, wired in by resolve.alias in
 * vitest.config.mts (matching both "@/lib/redis" and "./redis").
 *
 * Why fake rather than a real test Redis: the real module uses lazyConnect +
 * enableOfflineQueue, so with nothing listening commands QUEUE rather than
 * throw — a test would hang for the retry timeout instead of failing. And
 * requiring Docker/WSL just to run `npm test` on Windows is how a suite dies.
 *
 * This is also a test ASSET, not just a stub: `store` is exported so a test can
 * read the OTP the app just generated, and `set NX` returns null exactly like
 * the real thing, so the deposit idempotency lock can be asserted without
 * racing anything.
 *
 * Only the surface the app actually uses is implemented — verified by grep:
 * set, get, del, incr, mget, scan, pipeline, publish, duplicate, subscribe,
 * unsubscribe, on("message"), quit.
 */

interface Entry {
  value: string;
  /** epoch ms, or null for no expiry */
  expiresAt: number | null;
}

const bus = new EventEmitter();
// Node's default of 10 is easily exceeded by concurrent SSE subscribers.
bus.setMaxListeners(0);

class FakeRedis {
  /** Exposed so tests can inspect and seed keys directly. */
  readonly store = new Map<string, Entry>();
  private readonly channels = new Set<string>();
  private readonly handlers: ((channel: string, message: string) => void)[] = [];

  // ── keys ──────────────────────────────────────────────────────────────────

  /** Lazily honour TTLs — no timers to leak between tests. */
  private live(key: string): Entry | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    const flat = keys.flat() as string[];
    return flat.map((k) => this.live(k)?.value ?? null);
  }

  /**
   * Supports the two call shapes the app uses:
   *   set(k, v)
   *   set(k, v, "EX", seconds)
   *   set(k, v, "EX", seconds, "NX")   → null when the key already exists
   */
  async set(key: string, value: string, ...args: unknown[]): Promise<"OK" | null> {
    const upper = args.map((a) => (typeof a === "string" ? a.toUpperCase() : a));
    const nx = upper.includes("NX");
    const exAt = upper.indexOf("EX");
    const ttl = exAt >= 0 ? Number(args[exAt + 1]) : null;

    if (nx && this.live(key)) return null; // the idempotency lock losing its race

    this.store.set(key, {
      value,
      expiresAt: ttl && Number.isFinite(ttl) ? Date.now() + ttl * 1000 : null,
    });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    const flat = keys.flat() as string[];
    let n = 0;
    for (const k of flat) if (this.store.delete(k)) n++;
    return n;
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.live(key)?.value ?? 0) + 1;
    // INCR preserves the existing TTL.
    const prev = this.store.get(key);
    this.store.set(key, { value: String(next), expiresAt: prev?.expiresAt ?? null });
    return next;
  }

  async ttl(key: string): Promise<number> {
    const e = this.live(key);
    if (!e) return -2;                       // no such key
    if (e.expiresAt === null) return -1;     // no expiry
    return Math.ceil((e.expiresAt - Date.now()) / 1000);
  }

  /** Single-pass SCAN — returns cursor "0" and every match, which is a valid
   *  (if unrealistic) implementation of the contract callers rely on. */
  async scan(_cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
    const i = args.findIndex((a) => String(a).toUpperCase() === "MATCH");
    const pattern = i >= 0 ? String(args[i + 1]) : "*";
    const rx = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    const keys = [...this.store.keys()].filter((k) => rx.test(k) && this.live(k));
    return ["0", keys];
  }

  /** Minimal pipeline: queues ttl/get/del and resolves ioredis' [err, value] pairs. */
  pipeline() {
    const ops: (() => Promise<unknown>)[] = [];
    const chain = {
      ttl: (k: string) => { ops.push(() => this.ttl(k)); return chain; },
      get: (k: string) => { ops.push(() => this.get(k)); return chain; },
      del: (k: string) => { ops.push(() => this.del(k)); return chain; },
      exec: async () => Promise.all(ops.map(async (op) => [null, await op()] as [null, unknown])),
    };
    return chain;
  }

  // ── pub/sub (the two SSE routes) ──────────────────────────────────────────

  async publish(channel: string, message: string): Promise<number> {
    bus.emit(channel, message);
    return 1;
  }

  duplicate(): FakeRedis {
    // Subscribers share the module-level bus but keep their own subscriptions.
    return new FakeRedis();
  }

  async subscribe(...channels: string[]): Promise<number> {
    for (const ch of channels) {
      this.channels.add(ch);
      bus.on(ch, (msg: string) => {
        for (const h of this.handlers) h(ch, msg);
      });
    }
    return this.channels.size;
  }

  async unsubscribe(...channels: string[]): Promise<number> {
    const list = channels.length ? channels : [...this.channels];
    for (const ch of list) {
      bus.removeAllListeners(ch);
      this.channels.delete(ch);
    }
    return this.channels.size;
  }

  on(event: string, handler: (channel: string, message: string) => void): this {
    if (event === "message") this.handlers.push(handler);
    return this;
  }

  async quit(): Promise<"OK"> {
    await this.unsubscribe();
    return "OK";
  }

  /** Test helper — wipe everything between files. */
  flushall(): void {
    this.store.clear();
  }
}

export const redis = new FakeRedis();

/** Marker asserted in tests/db/setup.ts. An alias miss would otherwise HANG
 *  (enableOfflineQueue) rather than fail, which is very hard to diagnose. */
export const __isFakeRedis = true;

// Same values as src/lib/redis.ts — imported alongside `redis` by callers.
export const TTL_SMS = 24 * 60 * 60;
export const TTL_PENDING = 24 * 60 * 60;
export const TTL_USED = 30 * 24 * 60 * 60;
