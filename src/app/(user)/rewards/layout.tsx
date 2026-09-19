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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-16">
      <RewardsNav />

      <div className="mt-8 flex flex-col gap-10">{children}</div>
    </div>
  );
}
