"use client";

import { useId, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { celebrate } from "@/lib/celebrate";
import { segmentAngle, wrapLabel } from "@/lib/spinCore";
import { cn } from "@/lib/utils";

/*
 * Vegas prize wheel. Hand-authored inline SVG — alternating velvet wedges, a
 * gold rim with marquee bulbs, and a fixed pointer at 12 o'clock.
 *
 * The one rule that matters: the SERVER decides the outcome and returns the
 * wedge index; this component only animates to it. The wheel never free-spins
 * while the request is in flight, because that leaves you choosing between a
 * visible snap to the right wedge or letting the client pick the winner.
 */

export interface WheelSegment {
  id: string;
  label: string;
  /** "CASH" | "PHYSICAL" | "SPIN" | "NONE" — NONE is a try-again wedge. */
  kind: string;
  cashEtb: number;
  creditsAwarded: number;
  imageUrl: string | null;
  inStock: boolean;
}

interface SpinResponse {
  index: number;
  label: string;
  kind: string;
  cashEtb: number;
  creditsWon: number;
  payoutPot: string | null;
  spinCredits: number;
  segments: WheelSegment[];
}

/** A try-again wedge has an index (the wheel lands on it) but is still a loss. */
const isWin = (r: { index: number; kind: string }) => r.index >= 0 && r.kind !== "NONE";

const SIZE = 240;
const C = SIZE / 2;
const R_OUTER = 112;
const R_WEDGE = 100;
const R_HUB = 34;
const TURNS = 5;
const BULBS = 16;
const SPIN_MS = 4200;

/** Radius the label sits at. Further out than the art, because the arc — and so
 *  the room for text — grows with radius. */
const LABEL_R = 80;
/** Radius the prize art sits at, inboard of the label and clear of the hub. */
const IMG_R = 52;

/** Arc length one wedge occupies at a given radius. This, not a fixed character
 *  count, is what actually bounds how much label fits. */
function arcAt(radius: number, count: number): number {
  return (2 * Math.PI * radius) / count;
}

/** Two lines is what fits radially between the prize art and the rim. */
const MAX_LINES = 2;

/** Wedge path from the centre, clockwise, starting at 12 o'clock. */
function wedgePath(count: number, i: number): string {
  const a0 = (i * 2 * Math.PI) / count - Math.PI / 2;
  const a1 = ((i + 1) * 2 * Math.PI) / count - Math.PI / 2;
  const x0 = C + R_WEDGE * Math.cos(a0);
  const y0 = C + R_WEDGE * Math.sin(a0);
  const x1 = C + R_WEDGE * Math.cos(a1);
  const y1 = C + R_WEDGE * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${C} ${C} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R_WEDGE} ${R_WEDGE} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SpinWheel({
  initialSegments,
  initialCredits,
  enabled,
}: {
  initialSegments: WheelSegment[];
  initialCredits: number;
  enabled: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const [segments, setSegments] = useState(initialSegments);
  const [credits, setCredits] = useState(initialCredits);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResponse | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<SpinResponse | null>(null);

  const count = segments.length;
  const canSpin = enabled && credits > 0 && !spinning && count > 0;

  // Everything below scales with the prize count, so adding rows in the admin
  // panel narrows the art and the labels instead of overflowing the wedge.
  const fontSize = count <= 8 ? 8 : count <= 12 ? 7 : 6;
  // 0.58em is a workable average advance for bold sans digits and caps. The 0.9
  // trims for the chord being shorter than the arc, plus a little breathing room
  // off the wedge edges.
  const maxChars = count > 0
    ? Math.max(4, Math.floor((arcAt(LABEL_R, count) * 0.9) / (fontSize * 0.58)))
    : 0;
  // Art is capped both by the wedge's arc at its radius and by a sane maximum.
  const imgSize = count > 0 ? Math.min(34, arcAt(IMG_R, count) * 0.78) : 0;
  const lineHeight = fontSize * 1.1;

  async function spin() {
    if (!canSpin) return;
    setSpinning(true);
    setError("");
    setResult(null);

    let data: SpinResponse;
    try {
      const res = await fetch("/api/user/spin", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not spin.");
        setSpinning(false);
        return;
      }
      data = body as SpinResponse;
    } catch {
      setError("Network error — please try again.");
      setSpinning(false);
      return;
    }

    // Re-render the wedges from the response BEFORE rotating: an admin who
    // reordered prizes since page load would otherwise leave `index` pointing
    // at the wrong wedge.
    setSegments(data.segments);
    setCredits(data.spinCredits);
    pending.current = data;

    // A no-win has no wedge to land on — drift a whole number of turns so the
    // wheel still moves, then reveal.
    const target = data.index >= 0 ? segmentAngle(data.segments.length, data.index) : 0;

    setRotation((r) => {
      const current = ((r % 360) + 360) % 360;
      const delta = ((target - current) % 360 + 360) % 360;
      return r + 360 * TURNS + delta;
    });

    // Called in an event handler, not during render — no hydration concern.
    if (reducedMotion()) {
      reveal();
    } else {
      // transitionend can be missed (backgrounded tab, interrupted transition),
      // which would leave the button disabled forever. reveal() is idempotent.
      window.setTimeout(reveal, SPIN_MS + 300);
    }
  }

  function reveal() {
    const data = pending.current;
    if (!data) return;
    pending.current = null;
    setSpinning(false);
    setResult(data);
    if (isWin(data)) celebrate(data.cashEtb >= 1000 || data.kind === "PHYSICAL" ? 70 : 46);
  }

  return (
    <div className="flex flex-col items-center gap-5">
      {/* ── Wheel ── */}
      <div className="relative w-full max-w-[min(88vw,380px)] aspect-square mx-auto">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-full overflow-visible">
          <defs>
            <radialGradient id={`${uid}-sheen`} cx="35%" cy="28%" r="75%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
              <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
            </radialGradient>
            <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--gold-2)" />
              <stop offset="50%" stopColor="var(--gold)" />
              <stop offset="100%" stopColor="var(--gold-deep)" />
            </linearGradient>
            <linearGradient id={`${uid}-hub`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--gold-2)" />
              <stop offset="100%" stopColor="var(--gold-deep)" />
            </linearGradient>
            {segments.map((_, i) => (
              <linearGradient key={i} id={`${uid}-w${i}`} x1="0" y1="0" x2="0" y2="1">
                {i % 2 === 0 ? (
                  <>
                    <stop offset="0%" stopColor="#3B1466" />
                    <stop offset="100%" stopColor="var(--purple-deep)" />
                  </>
                ) : (
                  <>
                    <stop offset="0%" stopColor="#1A0B2E" />
                    <stop offset="100%" stopColor="#12071F" />
                  </>
                )}
              </linearGradient>
            ))}
          </defs>

          {/* Rotating group — the pointer deliberately sits outside it */}
          {/* The easing lives in CSS (.wheel-track) rather than inline, so the
              reduced-motion override is a media query and there's no
              server/client branch to cause a hydration mismatch. */}
          <g
            className="wheel-track"
            style={{ transform: `rotate(${rotation}deg)`, transformOrigin: `${C}px ${C}px` }}
            onTransitionEnd={reveal}
          >
            {segments.map((s, i) => {
              const mid = ((i + 0.5) * 360) / count - 90;
              const rad = (mid * Math.PI) / 180;
              const lx = C + LABEL_R * Math.cos(rad);
              const ly = C + LABEL_R * Math.sin(rad);
              const ix = C + IMG_R * Math.cos(rad);
              const iy = C + IMG_R * Math.sin(rad);

              // Tangential text on the lower half would otherwise render upside
              // down; flipping a half-turn keeps every label readable.
              const raw = mid + 90;
              const norm = ((raw % 360) + 360) % 360;
              const textAngle = norm > 90 && norm < 270 ? raw - 180 : raw;

              return (
                <g key={s.id} opacity={s.inStock ? 1 : 0.45}>
                  <path
                    d={wedgePath(count, i)}
                    fill={`url(#${uid}-w${i})`}
                    stroke="var(--gold-deep)"
                    strokeWidth="0.75"
                  />
                  {s.imageUrl && (
                    <image
                      href={s.imageUrl}
                      x={ix - imgSize / 2} y={iy - imgSize / 2}
                      width={imgSize} height={imgSize}
                      preserveAspectRatio="xMidYMid meet"
                      aria-hidden="true"
                    />
                  )}
                  <text
                    x={lx} y={ly}
                    fill={s.inStock ? "#FFF6DA" : "#9A8FB0"}
                    fontSize={fontSize}
                    fontWeight="700"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${textAngle} ${lx} ${ly})`}
                    style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.55)", strokeWidth: 1.6 }}
                  >
                    {/* SVG text doesn't wrap — one tspan per line, the block
                        centred on the label point by offsetting the first. */}
                    {wrapLabel(s.label, maxChars, MAX_LINES).map((line, li, all) => (
                      <tspan
                        key={li}
                        x={lx}
                        dy={li === 0 ? -((all.length - 1) / 2) * lineHeight : lineHeight}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                  {/* Full label for screen readers and hover, since the visible
                      one may be cut to fit the wedge. */}
                  <title>{s.label}</title>
                </g>
              );
            })}

            <circle cx={C} cy={C} r={R_WEDGE} fill={`url(#${uid}-sheen)`} pointerEvents="none" />
          </g>

          {/* Rim + marquee bulbs (static — they don't spin with the wheel) */}
          <circle cx={C} cy={C} r={R_WEDGE + 3} fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="6" />
          <circle cx={C} cy={C} r={R_OUTER} fill="none" stroke="var(--gold-deep)" strokeWidth="1.5" opacity="0.7" />
          {Array.from({ length: BULBS }, (_, i) => {
            const a = (i * 2 * Math.PI) / BULBS - Math.PI / 2;
            return (
              <circle
                key={i}
                cx={C + (R_WEDGE + 3) * Math.cos(a)}
                cy={C + (R_WEDGE + 3) * Math.sin(a)}
                r="2.6"
                fill="#FFF6DA"
                className="wheel-bulb"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            );
          })}

          {/* Hub */}
          <circle cx={C} cy={C} r={R_HUB} fill={`url(#${uid}-hub)`} stroke="var(--gold-deep)" strokeWidth="1.5" />
          <ellipse cx={C - 10} cy={C - 12} rx="9" ry="5" fill="#FFFFFF" opacity="0.3" />

          {/* Pointer — outside the rotating group so it stays at 12 o'clock */}
          <path
            d={`M ${C} ${C - R_WEDGE + 14} L ${C - 9} ${C - R_OUTER - 6} L ${C + 9} ${C - R_OUTER - 6} Z`}
            fill="var(--gold-2)"
            stroke="var(--gold-deep)"
            strokeWidth="1.5"
          />
        </svg>

        {/* Spin button sits over the hub */}
        <button
          onClick={spin}
          disabled={!canSpin}
          className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "w-[22%] aspect-square rounded-full grid place-items-center",
            "text-[#09090B] font-display font-extrabold text-[11px] leading-tight text-center",
            "transition-transform disabled:cursor-not-allowed",
            canSpin ? "hover:scale-105 active:scale-95" : "opacity-80",
          )}
        >
          {spinning ? <Loader2 className="w-4 h-4 animate-spin" /> : "SPIN"}
        </button>
      </div>

      {/* ── Status ── */}
      <p className="text-[13px] text-[color:var(--text-secondary)]">
        {enabled
          ? <>You have <span className="font-bold text-[color:var(--gold)]">{credits}</span> {credits === 1 ? "spin" : "spins"}</>
          : "The wheel is closed right now."}
      </p>

      {error && <p className="text-[13px] text-[color:var(--red)]">{error}</p>}

      <div aria-live="polite" className="min-h-[64px] w-full max-w-sm">
        {result && (
          <div className={cn(
            "rounded-2xl border p-4 text-center animate-pop",
            isWin(result)
              ? "border-[color:var(--border-accent)] bg-[var(--bg-accent-dim)]"
              : "border-[color:var(--border-base)] bg-[var(--bg-surface)]",
          )}>
            {isWin(result) ? (
              <>
                <Sparkles className="w-5 h-5 text-[color:var(--gold)] mx-auto mb-1.5" />
                <p className="text-[15px] font-bold text-[color:var(--text-primary)]">You won {result.label}!</p>
                <p className="text-[12px] text-[color:var(--text-secondary)] mt-1">
                  {result.kind === "PHYSICAL"
                    ? "We'll contact you to arrange handover."
                    : result.kind === "SPIN"
                      ? `${result.creditsWon} more ${result.creditsWon === 1 ? "spin" : "spins"} added — go again.`
                      : result.payoutPot === "withdrawable"
                        ? "Added to your balance — withdrawable straight away."
                        : "Added as bonus credit — play it through to unlock withdrawal."}
                </p>
              </>
            ) : (
              <>
                <p className="text-[15px] font-bold text-[color:var(--text-primary)]">No win this time</p>
                <p className="text-[12px] text-[color:var(--text-secondary)] mt-1">
                  {credits > 0 ? "You still have spins left — try again." : "Invite a friend to earn another spin."}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
