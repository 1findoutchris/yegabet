"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Download, Share, X } from "lucide-react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

const DISMISS_KEY = "installBannerDismissed";

export function InstallBanner() {
  const { canPrompt, isIOS, install: runPrompt } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(true);

  // Starts dismissed so the banner cannot flash before localStorage is read.
  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) !== null);
  }, []);

  function dismiss() {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, "1");
  }

  async function install() {
    if (await runPrompt()) dismiss();
  }

  // Dismissing hides the banner for good; the profile dropdown keeps offering
  // the install for anyone who closed this and changed their mind.
  if (dismissed || (!canPrompt && !isIOS)) return null;

  return (
    // Deliberately light against the app's near-black chrome. The inversion is
    // what makes it register as a separate app-store-style strip rather than
    // another dark row the eye skims past — the old dim version blended in.
    <div className="flex items-center gap-2.5 px-3 py-2.5 bg-white border-b border-black/10">
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 p-1 -ml-0.5 text-black/35 hover:text-black/70 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      <Image
        src="/icon-192.png"
        alt=""
        width={44}
        height={44}
        className="w-11 h-11 shrink-0 rounded-[10px] shadow-sm"
      />

      <div className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-extrabold leading-tight text-[#09090B] truncate">
          Fetan Bet
        </p>
        {isIOS ? (
          <p className="text-[11px] leading-tight text-black/55 mt-0.5">
            Tap <Share className="inline w-3 h-3 -mt-0.5" /> then{" "}
            <span className="font-semibold text-black/75">Add to Home Screen</span>
          </p>
        ) : (
          <p className="text-[11px] leading-tight text-black/55 mt-0.5">
            Free · Installs in seconds · No app store needed
          </p>
        )}
      </div>

      {!isIOS && (
        <button
          onClick={install}
          className="shine shrink-0 inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-gold-grad text-[#09090B] font-extrabold text-[13px] tracking-[0.02em] uppercase active:scale-95 transition-transform"
        >
          Install
          <Download className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
