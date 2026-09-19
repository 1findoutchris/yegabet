import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://vinnabet.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // "/" is not listed: it redirects to /casino carrying the query string, so
  // submitting it only gets it reported back as "Page with redirect". The lobby
  // is the landing page and carries priority 1.0 in its place.
  const routes: { path: string; priority: number; freq: "daily" | "weekly" }[] = [
    { path: "/casino",  priority: 1.0, freq: "daily" },
    { path: "/sports",  priority: 0.9, freq: "daily" },
    { path: "/games",   priority: 0.8, freq: "daily" },
    // "/rewards" is not listed: it sits behind a login gate, so all Googlebot
    // can see there is the log-in card. Submitting it would earn a soft 404 and
    // drag on the indexing of the three pages that ARE public.
  ];

  return routes.map((r) => ({
    url: `${BASE}${r.path}`,
    lastModified: now,
    changeFrequency: r.freq,
    priority: r.priority,
  }));
}
