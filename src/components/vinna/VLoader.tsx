import { cn } from "@/lib/utils";
import { VMark } from "./VMark";

/**
 * The animated VinnaBet mark used by every loader: the V draws itself inside a
 * slowly turning hairline ring, with a thin progress line underneath.
 */
export function VLoader({ size = 64, label, className }: { size?: number; label?: React.ReactNode; className?: string }) {
  const ring = size + 28;
  return (
    <div className={cn("flex flex-col items-center", className)} role="status" aria-live="polite">
      <div className="relative grid place-items-center" style={{ width: ring, height: ring }}>
        <svg className="absolute inset-0" viewBox="0 0 100 100" style={{ animation: "v-spin 2.4s linear infinite" }} aria-hidden>
          <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(148,170,210,0.12)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="47" fill="none" stroke="url(#vl-g)" strokeWidth="2" strokeLinecap="round" strokeDasharray="70 226" />
          <defs>
            <linearGradient id="vl-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#19D3C5" />
              <stop offset="1" stopColor="#5CE1F0" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
        <VMark size={size} animated />
      </div>
      {label && <div className="mt-5">{label}</div>}
    </div>
  );
}

/** Thin indeterminate line. */
export function VLine({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-[2px] w-40 overflow-hidden rounded-full bg-[rgba(148,170,210,0.12)]", className)} aria-hidden>
      <span
        className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-[linear-gradient(90deg,transparent,#19D3C5,#5CE1F0,transparent)]"
        style={{ animation: "v-line 1.3s cubic-bezier(0.4,0,0.2,1) infinite" }}
      />
    </div>
  );
}
