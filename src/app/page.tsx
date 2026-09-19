import { redirect } from "next/navigation";

/**
 * Marketing root → the lobby.
 *
 * The query string is carried across deliberately. Shared links land here
 * (`/?ref=…` from ReferralCard, `/?promo=…` from an admin rigged link), and a
 * bare `redirect("/casino")` drops the search params — so the attribution was
 * gone before any client code could read it, since AuthModal (which stashes
 * them) only mounts inside the (user) layout. Referral credit and guaranteed
 * prizes were both being lost silently, with no error anywhere.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) params.set(key, first);
  }

  const qs = params.toString();
  redirect(qs ? `/casino?${qs}` : "/casino");
}
