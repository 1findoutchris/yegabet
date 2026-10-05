import { RewardsNav } from "@/components/retention/RewardsNav";
import { LoginRequired } from "@/components/auth/LoginRequired";
import { auth } from "@/lib/auth";

/* Gated in the layout rather than in each of the seven section pages: one check
   nobody can forget to copy into the next tab that gets added. */
export default async function RewardsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <LoginRequired
        title="Rewards"
        message="Log in to track your points, tier, streak, challenges and cashback."
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16">
      <header className="mb-5">
        <p className="v-eyebrow text-[color:var(--v-teal)]">Progression</p>
        <h1 className="mt-1.5 text-[length:var(--v-fs-page)] font-extrabold tracking-[-0.03em] leading-none text-white">Rewards</h1>
      </header>
      <RewardsNav />

      <div className="mt-6 flex flex-col gap-9">{children}</div>
    </div>
  );
}
