import { defineConfig } from "vitest/config";
import path from "node:path";

const src = path.resolve(import.meta.dirname, "src");
const at = (p: string) => path.resolve(import.meta.dirname, p);

/**
 * Defined once and shared by every project — duplicating it per project is how
 * an entry silently ends up in some of them and not others.
 */
const alias = [
  // Redis must come before the "@/" rule, which would otherwise rewrite
  // "@/lib/redis" before this ever sees it.
  //
  // Both specifier forms have to be caught: the module is imported 7× as
  // "@/lib/redis" and 3× as "./redis". A miss is silent and nasty —
  // src/lib/redis.ts uses lazyConnect + enableOfflineQueue, so commands QUEUE
  // rather than throw and the test HANGS instead of failing.
  // tests/db/setup.ts asserts the fake is really in place.
  { find: /^(@\/lib\/redis|\.\/redis)$/, replacement: at("tests/fakeRedis.ts") },

  // `server-only` exists to throw when imported outside a React Server
  // Component. Vitest runs in plain Node and resolves that throwing entry, so
  // every module guarded by it dies on import.
  { find: /^server-only$/, replacement: at("tests/empty.ts") },

  { find: /^@\//, replacement: src + "/" },
];

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "tests/checks.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/db/globalSetup.ts"],
          setupFiles: ["tests/db/setup.ts"],
          // One shared remote database means exactly one writer. Without this,
          // parallel files truncate each other's fixtures mid-test.
          // (Vitest 4 dropped poolOptions; fileParallelism is what serialises.)
          fileParallelism: false,
          testTimeout: 30_000,   // every query is a Railway proxy round trip
          hookTimeout: 180_000,  // migrate reset replays every migration
        },
      },
    ],
  },
});
