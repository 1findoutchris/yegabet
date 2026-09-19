import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  DEFAULT_REWARD_CONFIG,
  mergeRewardConfig,
  type RewardConfig,
  type RewardBlockKey,
} from "./rewardConfigCore";

/*
 * DB-backed reward config. Same "DB override over static defaults" idea as
 * src/lib/paymentConfig.ts. Pure shape/defaults/merge live in rewardConfigCore.ts.
 */

export * from "./rewardConfigCore";

/**
 * The merged reward config. `react.cache` dedupes to one DB read per request
 * even when several routes/components call it. Falls back to defaults on any
 * error (missing table before migration, DB down) — mirrors getAgentOverrides().
 */
export const getRewardConfig = cache(async (): Promise<RewardConfig> => {
  try {
    const rows = await prisma.rewardConfig.findMany();
    return mergeRewardConfig(new Map(rows.map((r) => [r.key, r.value])));
  } catch {
    return DEFAULT_REWARD_CONFIG;
  }
});

/** Upsert one reward block. Value must already be validated by the caller. */
export async function setRewardConfig(key: RewardBlockKey, value: unknown): Promise<void> {
  const json = value as Prisma.InputJsonValue;
  await prisma.rewardConfig.upsert({
    where: { key },
    create: { key, value: json },
    update: { value: json },
  });
}
