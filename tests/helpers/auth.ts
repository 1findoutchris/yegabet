import { createAdminSession, ADMIN_COOKIE } from "@/lib/adminSession";
import { createPayoutSession, PAYOUT_COOKIE } from "@/lib/payoutSession";

/*
 * Admin and payout auth are two-factor: a secret header AND a Redis-backed
 * session cookie. Neither is mocked — the real session helpers run against the
 * fake Redis, so these tests exercise the actual guard code.
 *
 * The two failure codes are different on purpose and worth asserting:
 *   wrong/absent secret  → 404  (the portal stays hidden)
 *   wrong/absent session → 401
 */

/** Header + cookie pair that satisfies requireAdminAuth. */
export async function adminAuth(): Promise<{
  headers: Record<string, string>;
  cookies: Record<string, string>;
}> {
  const token = await createAdminSession(process.env.ADMIN_USERNAME ?? "testadmin");
  return {
    headers: { "x-admin-secret": process.env.ADMIN_SECRET ?? "" },
    cookies: { [ADMIN_COOKIE]: token },
  };
}

/** Correct secret, no session — should 401. */
export function adminSecretOnly(): { headers: Record<string, string> } {
  return { headers: { "x-admin-secret": process.env.ADMIN_SECRET ?? "" } };
}

/** Header + cookie pair for a payout agent. The agent row must already exist. */
export async function payoutAuth(agentId: string): Promise<{
  headers: Record<string, string>;
  cookies: Record<string, string>;
}> {
  const token = await createPayoutSession(agentId);
  return {
    headers: { "x-payout-secret": process.env.PAYOUT_SECRET ?? "" },
    cookies: { [PAYOUT_COOKIE]: token },
  };
}
