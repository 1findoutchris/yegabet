import { SkeletonMission } from "@/components/vinna/Skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="v-surface p-5 flex items-center gap-5">
        <div className="v-skel w-[104px] h-[104px] rounded-full" />
        <div className="flex-1 space-y-3">
          <div className="v-skel h-3 w-20" />
          <div className="v-skel h-6 w-36" />
          <div className="v-skel h-2.5 w-48" />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonMission key={i} />)}
      </div>
    </div>
  );
}
