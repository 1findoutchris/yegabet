import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sports Betting — Football, Live Odds & More",
  description:
    "Bet on football and live sports at VinnaBet. Pre-match and in-play odds in ETB, with instant telebirr, CBE Birr and eBirr deposits.",
  alternates: { canonical: "/sports" },
};

// SportsPane in the layout handles the sportsbook iframe.
// This page intentionally renders nothing.
export default function SportsPage() {
  return null;
}
