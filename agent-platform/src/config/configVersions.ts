import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Dated config (CLAUDE.md §2: "a config table with effective dates, so a change
 * never rewrites history"). Rows are append-only; the DB rejects UPDATE/DELETE.
 */

export interface ConfigVersionRow {
  id: bigint;
  key: string;
  value: Prisma.JsonValue;
  effectiveFrom: Date;
}

/**
 * The version of `key` in force at `at`: the latest row with effectiveFrom <= at.
 * `null` means "not configured at that time". Money callers must refuse to run
 * rather than fall back to a default.
 */
export async function configAt(db: PrismaClient, key: string, at: Date): Promise<ConfigVersionRow | null> {
  return db.configVersion.findFirst({
    where: { key, effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, key: true, value: true, effectiveFrom: true },
  });
}

/** Schedule a new value. Earlier versions stay exactly as they were. */
export async function addConfigVersion(
  db: PrismaClient,
  input: { key: string; value: Prisma.InputJsonValue; effectiveFrom: Date; createdBy: string },
): Promise<ConfigVersionRow> {
  return db.configVersion.create({
    data: input,
    select: { id: true, key: true, value: true, effectiveFrom: true },
  });
}
