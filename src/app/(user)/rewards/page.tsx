import { Zap } from "lucide-react";
import { auth } from "@/lib/auth";
import { getUserPoints } from "@/lib/loyalty";
import { getRewardConfig } from "@/lib/rewardConfig";
import { RewardProgress } from "@/components/vinna/RewardProgress";
import { ChallengeCard } from "@/components/retention/ChallengeCard";
import { WeeklyChallenges } from "@/components/retention/WeeklyChallenges";
import { AchievementsGrid } from "@/components/retention/AchievementsGrid";
import { CashbackCard } from "@/components/retention/CashbackCard";
import { PointsRules } from "@/components/retention/PointsRules";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rewards — XP, Levels & Missions",
  description:
    "Earn points on every bet at YegaBet, climb the tiers and clear weekly challenges for bonuses, cashback and free spins.",
  alternates: { canonical: "/rewards" },
};

export default async function RewardsOverviewPage() {
  const session = await auth();
  const points = await getUserPoints(session?.user?.id);
  const { tiers, pointsEconomy, achievements } = await getRewardConfig();

  return (
    <>
      <RewardProgress points={points} tiers={tiers} />

      <div className="grid lg:grid-cols-2 gap-9 lg:gap-6">
        <ChallengeCard />
        <WeeklyChallenges />
      </div>

      <AchievementsGrid achievements={achievements} limit={4} />

      <CashbackCard />

      {/* How XP is earned */}
      <section className="v-surface p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-[18px] h-[18px] text-[color:var(--v-teal)]" />
          <h3 className="text-[16px] font-bold text-white">How XP works</h3>
        </div>
        <PointsRules pointsPerEtb={pointsEconomy.pointsPerEtb} />
      </section>
    </>
  );
}
