import type { Metadata, Viewport } from "next";
import { Outfit, Sora } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Toaster } from "sonner";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-outfit",
  display: "swap",
});

// Expressive display face for headings, jackpots, and big numbers.
const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://fetanbet.bet";
const SITE_NAME = "Fetan Bet";
const DESCRIPTION =
  "Fetan Bet — the premier online casino and sports betting in Ethiopia. Play 1000+ slots and live casino games, bet on football and live sports, with instant telebirr, CBE Birr and eBirr deposits and fast withdrawals.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Fetan Bet — Online Casino & Sports Betting in Ethiopia",
    template: "%s · Fetan Bet",
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "Fetan Bet", "Fetan", "sports betting Ethiopia", "online casino Ethiopia",
    "betting Ethiopia", "Ethiopian betting site", "telebirr betting", "CBE Birr betting",
    "football betting", "live casino", "online slots", "ETB betting", "ውርርድ",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "games",
  // No `alternates.canonical` here on purpose. Metadata inherits, so a canonical
  // on the root layout is emitted by EVERY page — /casino, /sports, /games and
  // /rewards each declared "/" as their canonical, which is a redirect back to
  // /casino. Google reported all of them as "Alternative page with proper
  // canonical tag" and indexed none. Each indexable page sets its own.
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "Fetan Bet — Online Casino & Sports Betting in Ethiopia",
    description: DESCRIPTION,
    images: [{ url: "/icon.svg", width: 512, height: 512, alt: "Fetan Bet" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Fetan Bet — Online Casino & Sports Betting",
    description: DESCRIPTION,
    images: ["/icon.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  // Paste the token from Google Search Console into GOOGLE_SITE_VERIFICATION.
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
};

export const viewport: Viewport = {
  themeColor: "#0B0710",
  // viewport-fit=cover lets env(safe-area-inset-*) reach the mobile tab bar.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${sora.variable} dark h-full antialiased`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-outfit)]">
        {/* Organization + WebSite structured data → brand SERP result & sitelinks search box. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "Organization",
                name: SITE_NAME,
                url: SITE_URL,
                logo: `${SITE_URL}/icon-512.png`,
                description: DESCRIPTION,
                areaServed: "ET",
              },
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: SITE_NAME,
                // What Google may show instead of the bare domain in a result
                // header. Without these it only has "Fetan Bet" to work with.
                alternateName: ["FetanBet", "Fetan", "ፈጣን ቤት"],
                url: SITE_URL,
              },
            ]),
          }}
        />
        <Providers>{children}</Providers>
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            style: { background: "#15101D", border: "1px solid #2A2236", color: "#F6F2FA" },
          }}
        />
      </body>
    </html>
  );
}
