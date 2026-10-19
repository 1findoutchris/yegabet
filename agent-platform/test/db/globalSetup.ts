import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL, assertTestDatabase, schemaOf } from "./testDb";

/**
 * Fresh schema for every run: drop it, then apply the real migrations.
 * `public` is also given a stand-in for the old web app's `agents` table, so
 * the tests prove our schema never collides with it.
 */
export default async function globalSetup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  const schema = schemaOf(TEST_DATABASE_URL);
  if (!/^[a-z_]+$/.test(schema)) throw new Error(`unexpected schema name: ${schema}`);
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.delete("schema");
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    if (schema !== "public") {
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS public.agents (id TEXT PRIMARY KEY, legacy BOOLEAN)`,
      );
    }
  } finally {
    await db.$disconnect();
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
