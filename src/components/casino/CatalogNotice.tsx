import { catalogStatus } from "@/lib/catalog";

/**
 * Shown in place of the game lists while the Octhera catalog has no games —
 * before the first import, or when Octhera can't be reached. Says which.
 */
export async function CatalogNotice() {
  const { configured, lastSync } = await catalogStatus();
  const reason = !configured
    ? "The game catalog isn't connected yet."
    : lastSync && !lastSync.ok
    ? "Games aren't available right now."
    : "Games are loading — refresh in a minute.";
  return (
    <div className="rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-muted)] px-5 py-10 text-center">
      <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">{reason}</p>
      <p className="mt-2 text-[12px] text-[color:var(--text-muted)]">Please check back shortly.</p>
    </div>
  );
}
