import { cn } from "@/lib/utils";

/** Placeholder for one game card while its rail or grid loads. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("relative rounded-[16px] overflow-hidden aspect-[4/5] v-skel", className)} aria-hidden>
      <div className="absolute left-3 right-3 bottom-3 space-y-1.5">
        <div className="h-2 w-1/3 rounded bg-[var(--v-bg-3)]" />
        <div className="h-3 w-3/4 rounded bg-[var(--v-bg-3)]" />
      </div>
    </div>
  );
}

/** A section header + a horizontal row of card placeholders. */
export function SkeletonRail({ count = 7 }: { count?: number }) {
  return (
    <div aria-hidden>
      <div className="flex items-end justify-between mb-4">
        <div className="space-y-2">
          <div className="v-skel h-4 w-36" />
          <div className="v-skel h-2.5 w-52" />
        </div>
        <div className="v-skel h-3 w-14" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonCard key={i} className="shrink-0 w-[156px] sm:w-[168px]" />
        ))}
      </div>
    </div>
  );
}

/** A grid of card placeholders (2 columns on phones). */
export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" aria-hidden>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

/** Compact category pills placeholder. */
export function SkeletonPills({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-2 overflow-hidden" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="v-skel h-9 shrink-0 rounded-full" style={{ width: 64 + ((i * 23) % 40) }} />
      ))}
    </div>
  );
}

/** Sportsbook-style event row placeholder (league, time, teams, three odds). */
export function SkeletonEvent() {
  return (
    <div className="v-surface p-4" aria-hidden>
      <div className="v-skel h-2.5 w-28 mb-3" />
      <div className="flex items-center gap-4">
        <div className="space-y-2 flex-1">
          <div className="v-skel h-3 w-2/3" />
          <div className="v-skel h-3 w-1/2" />
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => <div key={i} className="v-skel h-10 w-14" />)}
        </div>
      </div>
    </div>
  );
}

/** Mission / reward card placeholder. */
export function SkeletonMission() {
  return (
    <div className="v-surface p-4" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="v-skel w-10 h-10 rounded-[12px]" />
        <div className="flex-1 space-y-2">
          <div className="v-skel h-3 w-2/3" />
          <div className="v-skel h-2 w-full rounded-full" />
        </div>
        <div className="v-skel h-6 w-14 rounded-full" />
      </div>
    </div>
  );
}
