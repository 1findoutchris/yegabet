"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface CategoryTab {
  id: string;
  label: string;
  href?: string;
  icon?: React.ReactNode;
  count?: number;
}

/**
 * Compact horizontal category pills. Pass `href` for navigation, or `onSelect`
 * for in-page filtering; `active` marks the current one.
 */
export function CategoryTabs({
  tabs,
  active,
  onSelect,
  className,
  label = "Categories",
}: {
  tabs: CategoryTab[];
  active?: string;
  onSelect?: (id: string) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("v-rail gap-2 py-0.5", className)}>
      {tabs.map((t) => {
        const on = t.id === active;
        const inner = (
          <>
            {t.icon}
            {t.label}
            {typeof t.count === "number" && (
              <span className={cn("text-[11px] tabular-nums", on ? "opacity-70" : "text-[color:var(--v-text-3)]")}>{t.count}</span>
            )}
          </>
        );
        return t.href && !onSelect ? (
          <Link key={t.id} href={t.href} role="tab" aria-selected={on} data-active={on} className="v-pill shrink-0">
            {inner}
          </Link>
        ) : (
          <button key={t.id} role="tab" aria-selected={on} data-active={on} onClick={() => onSelect?.(t.id)} className="v-pill shrink-0">
            {inner}
          </button>
        );
      })}
    </div>
  );
}
