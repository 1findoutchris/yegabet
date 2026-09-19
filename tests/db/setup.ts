import { vi } from "vitest";
import { assertTestDatabase } from "../guard";
import { __isFakeRedis } from "../fakeRedis";

/*
 * Runs inside each test worker, before that worker's test files.
 *
 * globalSetup runs in the parent process, so its env mutations do not
 * necessarily cross the fork boundary — the guard runs again here rather than
 * assuming DATABASE_URL already points somewhere safe.
 */
try {
  process.loadEnvFile(".env.test");
} catch {
  /* CI, or no local file */
}
assertTestDatabase();

/*
 * Confirm the Redis alias actually took effect.
 *
 * Without this the failure mode is awful: src/lib/redis.ts uses lazyConnect +
 * enableOfflineQueue, so if the alias misses (say someone adds an import from a
 * subdirectory that the regex doesn't match) commands QUEUE instead of
 * throwing, and the test HANGS until the timeout rather than failing with
 * anything useful.
 */
const { redis } = await import("@/lib/redis");
if (!(redis as unknown as { __proto__: unknown }) || !__isFakeRedis) {
  throw new Error("tests/fakeRedis.ts was not loaded");
}
if (!("flushall" in redis) || typeof (redis as { flushall?: unknown }).flushall !== "function") {
  throw new Error(
    "REAL Redis is loaded, not the fake — check the resolve.alias regex in vitest.config.mts.\n" +
      "It must match BOTH \"@/lib/redis\" and \"./redis\". Left unfixed, DB tests hang instead of failing.",
  );
}

/*
 * NextAuth session, mocked once for every DB test file.
 *
 * All 22 user routes call the same `await auth()`, so one mock covers them.
 * Minting a real JWT just to have the handler decode it would be testing
 * NextAuth, not our code — E2E does that end to end instead.
 */
vi.mock("@/lib/auth", async () => {
  const { current } = await import("../helpers/session");
  return {
    auth: async () => current.session,
    signIn: vi.fn(),
    signOut: vi.fn(),
    handlers: {},
  };
});
