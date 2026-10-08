import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Compact page title for a lobby — no hero, games start right below. */
export function LobbyHeader({
  eyebrow,
  title,
  description,
  allHref,
  count,
}: {
  eyebrow: string;
  title: string;
  description: string;
  allHref: string;
  count: number;
}) {
  return (
    <header className="flex items-end gap-3">
      <div className="min-w-0">
        <p className="v-eyebrow text-[color:var(--v-teal)]">{eyebrow}</p>
        <h1 className="mt-1 text-[length:var(--v-fs-page)] font-extrabold tracking-[-0.03em] leading-none text-white">{title}</h1>
        <p className="mt-1.5 text-[13px] text-[color:var(--v-text-3)] truncate">{description}</p>
      </div>
      <Link
        href={allHref}
        className="ml-auto shrink-0 inline-flex items-center gap-1 h-9 pl-3.5 pr-2.5 rounded-full text-[12.5px] font-semibold text-white bg-[var(--v-bg-2)] border border-[color:var(--v-line-2)] hover:border-[color:var(--v-teal-a24)] transition-colors"
      >
        All <span className="tabular-nums text-[color:var(--v-text-3)]">{count.toLocaleString()}</span>
        <ChevronRight className="w-4 h-4" />
      </Link>
    </header>
  );
}
