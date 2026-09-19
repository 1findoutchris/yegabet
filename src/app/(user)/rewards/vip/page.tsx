import { auth } from "@/lib/auth";
import { getUserPoints } from "@/lib/loyalty";
import { getRewardConfig } from "@/lib/rewardConfig";
import { VipProgram } from "@/components/retention/VipProgram";
import { TierLadder } from "@/components/retention/TierLadder";

export default async function VipPage() {
  const session = await auth();
  const points = await getUserPoints(session?.user?.id);
  const { tiers } = await getRewardConfig();

  return (
    <>
      <VipProgram />
      <TierLadder points={points} tiers={tiers} />
    </>
  );
}
