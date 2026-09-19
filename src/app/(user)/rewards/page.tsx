import { Coins } from "lucide-react";
import { auth } from "@/lib/auth";
import { getUserPoints } from "@/lib/loyalty";
import { getRewardConfig } from "@/lib/rewardConfig";
import { RankProgress } from "@/components/retention/RankProgress";
import { WeeklyChallenges } from "@/components/retention/WeeklyChallenges";
import { PointsRules } from "@/components/retention/PointsRules";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rewards — Points, Tiers & Weekly Challenges",
  description:
    "Earn points on every bet at Fetan Bet, climb the tiers and clear weekly challenges for bonuses, cashback and free spins.",
  alternates: { canonical: "/rewards" },
};

export default async function RewardsOverviewPage() {
  const session = await auth();
  const points = await getUserPoints(session?.user?.id);
  const { tiers, pointsEconomy } = await getRewardConfig();

  return (
    <>
      <RankProgress points={points} tiers={tiers} />

      <WeeklyChallenges />

      {/* How points are earned */}
      <section className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Coins className="w-[18px] h-[18px] text-[color:var(--gold)]" />
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">How points work</h3>
        </div>
        <PointsRules pointsPerEtb={pointsEconomy.pointsPerEtb} />
      </section>
    </>
  );
}
