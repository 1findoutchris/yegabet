import { LaunchOverlay } from "@/components/vinna/LaunchOverlay";

// Shown between tapping a card and the player page arriving, so a launch reads
// as one continuous transition rather than a page change.
export default function Loading() {
  return (
    <div className="fixed inset-x-0 top-14 bottom-0 z-40 bg-black">
      <LaunchOverlay name={null} />
    </div>
  );
}
