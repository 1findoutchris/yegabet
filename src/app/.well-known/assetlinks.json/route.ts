import { NextResponse } from "next/server";

// Android App Links verification for the app's https://vinna.bet intent filter.
// ANDROID_CERT_SHA256 is the SHA-256 fingerprint of the signing key (Play
// Console → App integrity, or `keytool -list -v`); comma-separate several,
// e.g. the upload key and the Play app-signing key.
export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return NextResponse.json(
    fingerprints.length
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: "com.vinnabet.app",
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [],
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
