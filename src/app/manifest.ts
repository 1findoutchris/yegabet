import type { MetadataRoute } from "next";

// Web App Manifest — makes YegaBet installable (Add to Home Screen) and
// launch full-screen. App Router wires the <link rel="manifest"> automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YegaBet",
    short_name: "YegaBet",
    description:
      "YegaBet — Ethiopia's premier online sports betting and casino.",
    // Installed app opens on the player home, not the marketing root.
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
