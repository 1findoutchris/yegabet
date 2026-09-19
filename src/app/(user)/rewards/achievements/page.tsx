import { getRewardConfig } from "@/lib/rewardConfig";
import { AchievementsGrid } from "@/components/retention/AchievementsGrid";

export default async function AchievementsPage() {
  const { achievements } = await getRewardConfig();
  return <AchievementsGrid achievements={achievements} />;
}
