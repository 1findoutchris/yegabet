import type { PrismaClient } from "@prisma/client";

/**
 * Unfinished-but-deployed features stay dark (CLAUDE.md §8): a flag with no row
 * is off, so a new flag needs no migration and can never be on by accident.
 */
export async function isEnabled(db: PrismaClient, key: string): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({ where: { key }, select: { enabled: true } });
  return flag?.enabled ?? false;
}

export async function setFlag(
  db: PrismaClient,
  key: string,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  await db.featureFlag.upsert({
    where: { key },
    create: { key, enabled, updatedBy },
    update: { enabled, updatedBy, updatedAt: new Date() },
  });
}
