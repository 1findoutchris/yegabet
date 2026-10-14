"use client";

import { useEffect, useState } from "react";
import { VLoader, VLine } from "./VLoader";

const MESSAGES = ["Loading your experience", "Connecting games", "Preparing markets", "Almost ready"];
const SEEN_KEY = "vinna:splash-seen";
/** How long the first visit of a session holds the splash, at least. */
const FIRST_MS = 1100;

/**
 * App launch screen. It is in the server HTML, so it covers the page from the
 * very first paint instead of a blank or half-styled screen, and steps aside
 * once the app has hydrated: after a short beat on the first visit of a
 * session, straight away after that. A CSS fallback fades it out on its own
 * if scripts never run.
 */
export function LoadingScreen() {
  const [phase, setPhase] = useState<"show" | "leave" | "gone">("show");
  const [msg, setMsg] = useState(0);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === "1"; sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ }
    const leave = setTimeout(() => setPhase("leave"), seen ? 0 : FIRST_MS);
    const gone = setTimeout(() => setPhase("gone"), (seen ? 0 : FIRST_MS) + 320);
    const tick = setInterval(() => setMsg((m) => (m + 1) % MESSAGES.length), 520);
    return () => { clearTimeout(leave); clearTimeout(gone); clearInterval(tick); };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden={phase !== "show"}
      className="v-splash fixed inset-0 z-[400] grid place-items-center bg-[var(--v-bg-0)] transition-opacity duration-300"
      style={{ opacity: phase === "leave" ? 0 : 1, pointerEvents: phase === "leave" ? "none" : undefined }}
    >
      {/* faint grid + top light, no particles to keep it cheap */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.35]"
        style={{
          background:
            "radial-gradient(600px 300px at 50% 38%, rgba(255, 122, 0,0.10), transparent 70%)," +
            "linear-gradient(rgba(200, 200, 200,0.05) 1px, transparent 1px) 0 0 / 44px 44px," +
            "linear-gradient(90deg, rgba(200, 200, 200,0.05) 1px, transparent 1px) 0 0 / 44px 44px",
          maskImage: "radial-gradient(closest-side, #000, transparent)",
          WebkitMaskImage: "radial-gradient(closest-side, #000, transparent)",
        }}
      />
      <div className="relative flex flex-col items-center">
        <VLoader size={68} />
        <p className="mt-6 text-[15px] font-extrabold tracking-[0.42em] pl-[0.42em] text-white">
          YEGA<span className="text-[color:var(--v-teal)]">BET</span>
        </p>
        <VLine className="mt-5" />
        <p key={msg} className="mt-4 h-4 text-[12px] font-medium text-[color:var(--v-text-3)] v-fade-up">
          {MESSAGES[msg]}
        </p>
      </div>
    </div>
  );
}
