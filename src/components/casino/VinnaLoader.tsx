import { VLoader } from "@/components/vinna/VLoader";
import { SkeletonGameGrid, SkeletonRail, SkeletonPills } from "@/components/vinna/Skeleton";

/* Route loading state for player pages: the YegaBet mark over the shape of
   the page that is coming, so nothing ever flashes blank. */
export function VinnaLoader() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex justify-center py-8">
        <VLoader size={44} />
      </div>
      <div className="space-y-8 opacity-80">
        <SkeletonPills />
        <SkeletonGameGrid />
        <SkeletonRail />
      </div>
    </div>
  );
}
