import { execFileSync } from "node:child_process";
import { assertTestDatabase } from "../guard";

/*
 * Runs once, before any DB test file is loaded.
 *
 * Order is deliberate and load-bearing:
 *   1. load .env.test
 *   2. GUARD — throws here abort the whole run before anything connects
 *   3. only then reset the schema
 *
 * The reset doubles as the migration-replay check: if the 26 migrations cannot
 * apply to an empty database, the suite fails before a single test runs. That
 * is the class of bug where columns and tables existed only because someone
 * had run `prisma db push`.
 */
export default async function setup() {
  // Node ≥20.12 stdlib — no dotenv dependency. CI supplies env directly, so a
  // missing file is fine. `.env` (which holds the LIVE url) is never loaded.
  try {
    process.loadEnvFile(".env.test");
  } catch {
    /* CI, or no local file */
  }

  const url = assertTestDatabase();
  const target = new URL(url);
  console.log(`\n[db] target: ${target.hostname}:${target.port}${target.pathname}`);

  // TEST_DB_FAST=1 skips the full replay for a quicker local loop. CI never
  // sets it, so CI always exercises the migration chain from empty.
  const fast = process.env.TEST_DB_FAST === "1";
  const args = fast
    ? ["prisma", "migrate", "deploy"]
    : ["prisma", "migrate", "reset", "--force", "--skip-seed", "--skip-generate"];

  console.log(`[db] ${fast ? "migrate deploy" : "migrate reset"} …`);
  execFileSync("npx", args, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
    shell: process.platform === "win32",
  });

  // Shared, immutable fixtures. getRewardConfig() is read by register, deposit,
  // withdraw, spin, the provider callback and admin/users — nothing works
  // without it, and `migrate reset` leaves the schema empty.
  const { seedSharedFixtures } = await import("../factories");
  await seedSharedFixtures();
  console.log("[db] shared fixtures seeded\n");
}
