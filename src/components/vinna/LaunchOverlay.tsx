import { VLoader, VLine } from "./VLoader";

/**
 * Game launch screen: dark field, the animated mark, "Launching {game}". It
 * covers the player area while /api/games/launch makes the URL and the game's
 * iframe boots; the player removes it once the frame has loaded.
 */
export function LaunchOverlay({
  name,
  provider,
  children,
}: {
  name: string | null;
  provider?: string | null;
  /** Extra content under the loader (slow-load actions). */
  children?: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center px-6 bg-[radial-gradient(520px_280px_at_50%_42%,rgba(255, 122, 0,0.08),transparent_70%),var(--v-bg-0)] v-fade-in">
      <div className="flex flex-col items-center text-center">
        <VLoader size={56} />
        <p className="mt-6 v-eyebrow">{provider ?? "YegaBet"}</p>
        <p className="mt-1.5 text-[18px] font-bold text-white max-w-[280px]">
          Launching {name ?? "your game"}
        </p>
        <VLine className="mt-4" />
        {children}
      </div>
    </div>
  );
}
