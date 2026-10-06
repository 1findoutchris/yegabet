import { NextResponse } from "next/server";

// Universal links for the iOS app (ios/App/App/App.entitlements). Apple fetches
// this from https://vinna.bet/.well-known/apple-app-site-association.
// APPLE_TEAM_ID is the 10-character Team ID from the Apple Developer account.
export function GET() {
  const teamId = process.env.APPLE_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID ?? "com.vinnabet.app";
  const appIDs = teamId ? [`${teamId}.${bundleId}`] : [];

  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs,
            components: [
              // Staff portals and APIs always stay in the browser.
              { "/": "/api/*", exclude: true },
              { "/": "/admin/*", exclude: true },
              { "/": "/payout/*", exclude: true },
              { "/": "/in-person-agent/*", exclude: true },
              { "/": "/*" },
            ],
          },
        ],
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
