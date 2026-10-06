"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Flashlight, Loader2, X } from "lucide-react";
import type { IScannerControls } from "@zxing/browser";
import type { DecodeHintType as HintType } from "@zxing/library";
import { normalizeCode } from "@/lib/ticketCode";
import { useNativeBack } from "@/hooks/useNativeBack";

/*
 * Full-screen camera scanner for the Code 128 barcode on printed tickets.
 * Reads with ZXing (pure JS — works in iPhone Safari, which has no native
 * BarcodeDetector), loaded only when the scanner opens. Hands back the code
 * as read; anything that isn't shaped like a ticket code is ignored with a
 * hint and scanning carries on.
 */

type Phase = "starting" | "scanning" | "denied" | "unavailable";

export function BarcodeScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const doneRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("starting");
  const [hint, setHint] = useState("");
  const [torch, setTorch] = useState<boolean | null>(null); // null = not supported
  // Escape (and the app's back button) close the scanner, like the X does.
  useNativeBack(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setPhase("unavailable"); return; }
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (cancelled || !videoRef.current) return;
        const hints = new Map<HintType, unknown>([
          [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]],
          [DecodeHintType.TRY_HARDER, true],
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          videoRef.current,
          (result) => {
            if (!result || doneRef.current) return;
            const text = result.getText();
            if (!normalizeCode(text)) { setHint("That barcode isn't a VinnaBet ticket"); return; }
            doneRef.current = true;
            navigator.vibrate?.(60);
            controlsRef.current?.stop();
            onScan(text);
          },
        );
        if (cancelled) { controls.stop(); return; }
        controlsRef.current = controls;
        if (controls.switchTorch) setTorch(false);
        setPhase("scanning");
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      }
    })();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [onScan]);

  async function toggleTorch() {
    const c = controlsRef.current;
    if (!c?.switchTorch || torch === null) return;
    try { await c.switchTorch(!torch); setTorch(!torch); } catch { setTorch(null); }
  }

  return (
    <div className="fixed inset-0 z-[400] bg-black flex flex-col print:hidden" role="dialog" aria-label="Scan ticket barcode">
      <div className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 text-white">
        <p className="text-[15px] font-bold">Scan ticket</p>
        <div className="flex items-center gap-2">
          {torch !== null && (
            <button onClick={toggleTorch} aria-label={torch ? "Turn flash off" : "Turn flash on"}
              className={`w-10 h-10 grid place-items-center rounded-full ${torch ? "bg-white text-black" : "bg-white/15"}`}>
              <Flashlight className="w-5 h-5" />
            </button>
          )}
          <button onClick={onClose} aria-label="Close scanner" className="w-10 h-10 grid place-items-center rounded-full bg-white/15">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />

        {phase === "scanning" && (
          <>
            {/* Wide frame — a 1D barcode is short and long. */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[82%] max-w-[420px] aspect-[2.6/1] rounded-2xl border-2 border-[color:var(--gold)] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
              <div className="absolute left-3 right-3 top-1/2 h-0.5 bg-red-500/80 animate-pulse" />
            </div>
            <p className="absolute left-0 right-0 bottom-[18%] px-6 text-center text-[13px] text-white">
              {hint || "Align the barcode inside the frame"}
            </p>
          </>
        )}

        {phase === "starting" && (
          <div className="absolute inset-0 grid place-items-center text-white">
            <div className="flex flex-col items-center gap-2 text-[13px]">
              <Loader2 className="w-6 h-6 animate-spin" /> Starting camera…
            </div>
          </div>
        )}

        {(phase === "denied" || phase === "unavailable") && (
          <div className="absolute inset-0 grid place-items-center px-8 text-center text-white">
            <div className="space-y-3">
              <Camera className="w-8 h-8 mx-auto opacity-70" />
              <p className="text-[14px] font-semibold">
                {phase === "denied" ? "Camera access was blocked" : "Unable to open the camera"}
              </p>
              <p className="text-[12px] text-white/70">
                {phase === "denied"
                  ? "Allow camera access for VinnaBet in your phone or browser settings, or enter the ticket code instead."
                  : "This device or browser can't scan here. Enter the ticket code instead."}
              </p>
              <button onClick={onClose} className="mt-2 px-4 py-2.5 rounded-xl bg-white text-black text-[13px] font-bold">
                Enter code manually
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <button onClick={onClose} className="w-full px-4 py-3 rounded-xl bg-white/10 text-white text-[13px] font-semibold">
          Enter code manually
        </button>
      </div>
    </div>
  );
}
