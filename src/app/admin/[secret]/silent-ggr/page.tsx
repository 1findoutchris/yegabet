import { redirect } from "next/navigation";

// Silent GGR is now part of Provider GGR (one row per Silent provider, with
// Silent API's 10% per-round agreement carried over). Old bookmarks land there.
export default async function SilentGgrMoved({ params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  redirect(`/admin/${secret}/provider-ggr`);
}
