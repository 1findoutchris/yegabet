/**
 * Fire a one-shot confetti burst from the top of the viewport.
 * Pure DOM (no deps), self-cleaning, and a no-op under prefers-reduced-motion.
 * Call it from any client event handler, e.g. on a successful claim.
 */
const COLORS = ["#FF7A00", "#FFB366", "#C07AFF", "#D8B4FF", "#2BD974"];

export function celebrate(count = 46) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden";

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    const w = 6 + Math.random() * 8;
    const dur = 1.6 + Math.random() * 1.4;
    piece.style.cssText =
      `position:absolute;top:-12px;left:${Math.random() * 100}%;` +
      `width:${w}px;height:${w * 0.6}px;border-radius:1px;` +
      `background:${COLORS[i % COLORS.length]};` +
      `transform:rotate(${Math.random() * 360}deg);` +
      `animation:confettiFall ${dur}s cubic-bezier(.2,.6,.3,1) ${Math.random() * 0.35}s forwards`;
    root.appendChild(piece);
  }

  document.body.appendChild(root);
  setTimeout(() => root.remove(), 3400);
}
