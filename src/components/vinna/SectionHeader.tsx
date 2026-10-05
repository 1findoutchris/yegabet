import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Title, optional one-line description, and a "View all" link. */
export function SectionHeader({
  title,
  description,
  href,
  count,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  href?: string;
  count?: number;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-[length:var(--v-fs-section)] font-bold tracking-[-0.02em] text-white leading-tight">{title}</h2>
        {description && <p className="text-[13px] text-[color:var(--v-text-3)] mt-1 truncate">{description}</p>}
      </div>
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {actions}
        {href && (
          <Link
            href={href}
            className="group inline-flex items-center gap-0.5 h-8 pl-3 pr-2 rounded-full text-[12px] font-semibold text-[color:var(--v-text-2)] bg-[var(--v-bg-2)] border border-[color:var(--v-line)] hover:text-white hover:border-[color:var(--v-line-2)] transition-colors"
          >
            View all
            {typeof count === "number" && <span className="ml-1 text-[color:var(--v-text-3)] tabular-nums">{count}</span>}
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
