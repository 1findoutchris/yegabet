import { Disc3 } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRewardConfig } from "@/lib/rewardConfig";
import { SpinWheel, type WheelSegment } from "@/components/retention/SpinWheel";
import { ReferralCard } from "@/components/account/ReferralCard";

export default async function SpinPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const [user, prizes, { spinWheel }] = await Promise.all([
    userId
      ? prisma.user.findUnique({
          where: { id: userId },
          select: { spinCredits: true, referralCode: true },
        })
      : Promise.resolve(null),
    prisma.spinPrize.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    getRewardConfig(),
  ]);

  // Mirrors the shape /api/user/spin returns, so the client can swap the whole
  // list from a spin response without a second mapping.
  const segments: WheelSegment[] = prizes.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    cashEtb: Number(p.cashEtb),
    creditsAwarded: p.creditsAwarded,
    imageUrl: p.imageKey ? `/api/rewards/prize/${p.id}/image` : null,
    // A try-again wedge is never consumed, so stock doesn't apply to it.
    inStock: p.kind === "NONE" || p.stock > 0,
  }));

  const recentWins = await prisma.spinResult.findMany({
    where: { kind: { not: "NONE" } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, label: true, createdAt: true },
  });

  return (
    <>
      <section className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-1">
          <Disc3 className="w-[18px] h-[18px] text-[color:var(--gold)]" />
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">
            Prize wheel
          </h3>
        </div>
        <p className="text-[12px] text-[color:var(--text-secondary)] mb-6">
          Every friend who signs up with your code earns you a spin.
        </p>

        {userId ? (
          <SpinWheel
            initialSegments={segments}
            initialCredits={user?.spinCredits ?? 0}
            enabled={spinWheel.enabled}
          />
        ) : (
          <p className="text-[13px] text-[color:var(--text-secondary)] text-center py-8">
            Log in to see your spins and play the wheel.
          </p>
        )}
      </section>

      {userId && user?.referralCode && (
        <section>
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)] mb-3">
            Earn more spins
          </h3>
          <ReferralCard code={user.referralCode} />
        </section>
      )}

      {recentWins.length > 0 && (
        <section className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] p-5 sm:p-6">
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)] mb-3">
            Recent winners
          </h3>
          <ul className="flex flex-col gap-2">
            {recentWins.map((w) => (
              <li key={w.id} className="flex items-center justify-between text-[13px]">
                <span className="text-[color:var(--text-primary)] font-semibold">{w.label}</span>
                <span className="text-[color:var(--text-muted)] text-[12px]">
                  {w.createdAt.toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
