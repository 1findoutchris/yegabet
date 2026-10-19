import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL, assertTestDatabase } from "./testDb";

/** Fresh schema for every run: drop everything, then apply the real migrations. */
export default async function globalSetup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  try {
    await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await db.$executeRawUnsafe("CREATE SCHEMA public");
  } finally {
    await db.$disconnect();
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
