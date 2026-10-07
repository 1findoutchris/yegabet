import type { Metadata } from "next";
import { Suspense } from "react";
import { ContinueLogin } from "./ContinueLogin";

// Landing page for the bot's "Continue on Website" button.
export const metadata: Metadata = {
  title: "Signing you in",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ContinuePage() {
  return (
    <Suspense>
      <ContinueLogin />
    </Suspense>
  );
}
