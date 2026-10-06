import "server-only";
import { createSign, sign as signRaw } from "node:crypto";
import http2 from "node:http2";
import { prisma } from "@/lib/prisma";

/*
 * Push to the native iOS/Android apps. Android tokens are FCM registration
 * tokens (sent with the FCM HTTP v1 API); iOS tokens are raw APNs device
 * tokens (sent straight to APNs with a .p8 key, no Firebase SDK in the app).
 *
 * Both are optional: with no credentials configured, that platform is skipped.
 *
 *   FCM_SERVICE_ACCOUNT   Firebase service-account JSON (one line)
 *   APNS_KEY_ID           Key ID of the APNs auth key (.p8)
 *   APNS_TEAM_ID          Apple Developer Team ID
 *   APNS_PRIVATE_KEY      Contents of the .p8 file (\n escapes are fine)
 *   APNS_BUNDLE_ID        Defaults to com.vinnabet.app
 */

export interface NativePushPayload {
  title: string;
  body: string;
  url?: string;
}

type SendResult = "ok" | "invalid" | "error";

// ── FCM (Android) ──────────────────────────────────────────────────────────

interface ServiceAccount { project_id: string; client_email: string; private_key: string }

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch {
    console.error("[nativePush] FCM_SERVICE_ACCOUNT is not valid JSON");
    return null;
  }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

let fcmToken: { value: string; expires: number } | null = null;

async function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  if (fcmToken && fcmToken.expires > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }));
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key.replace(/\\n/g, "\n"));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`FCM auth failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  fcmToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function sendFcm(sa: ServiceAccount, token: string, p: NativePushPayload): Promise<SendResult> {
  const access = await fcmAccessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: p.title, body: p.body },
        data: p.url ? { url: p.url } : {},
        android: { priority: "HIGH", notification: { sound: "default" } },
      },
    }),
  });
  if (res.ok) return "ok";
  // 404 UNREGISTERED: app uninstalled / token rotated. 400 on a bad token.
  if (res.status === 404) return "invalid";
  const text = await res.text().catch(() => "");
  if (res.status === 400 && /registration token|UNREGISTERED|INVALID_ARGUMENT/.test(text)) return "invalid";
  console.error("[nativePush] FCM send failed", res.status, text.slice(0, 300));
  return "error";
}

// ── APNs (iOS) ─────────────────────────────────────────────────────────────

let apnsJwt: { value: string; issued: number } | null = null;

function apnsAuth(): string | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const key = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !key) return null;
  // Apple wants the token refreshed at most every 20 min, and at least hourly.
  if (apnsJwt && Date.now() - apnsJwt.issued < 40 * 60_000) return apnsJwt.value;
  const unsigned =
    b64url(JSON.stringify({ alg: "ES256", kid: keyId })) + "." +
    b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const signature = signRaw("sha256", Buffer.from(unsigned), {
    key: key.replace(/\\n/g, "\n"),
    dsaEncoding: "ieee-p1363",
  });
  apnsJwt = { value: `${unsigned}.${b64url(signature)}`, issued: Date.now() };
  return apnsJwt.value;
}

function apnsRequest(host: string, jwt: string, token: string, p: NativePushPayload): Promise<{ status: number; reason?: string }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    client.on("error", reject);
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": process.env.APNS_BUNDLE_ID ?? "com.vinnabet.app",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    req.on("response", (h) => { status = Number(h[":status"]); });
    req.setEncoding("utf8");
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      client.close();
      let reason: string | undefined;
      try { reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined; } catch {}
      resolve({ status, reason });
    });
    req.on("error", (e) => { client.close(); reject(e); });
    req.end(JSON.stringify({
      aps: { alert: { title: p.title, body: p.body }, sound: "default" },
      ...(p.url ? { url: p.url } : {}),
    }));
  });
}

async function sendApns(jwt: string, token: string, p: NativePushPayload): Promise<SendResult> {
  // App Store/TestFlight builds use production APNs; builds run from Xcode use
  // the sandbox. A sandbox token is "BadDeviceToken" in production, so retry
  // there before treating the token as dead.
  for (const host of ["api.push.apple.com", "api.sandbox.push.apple.com"]) {
    const r = await apnsRequest(host, jwt, token, p);
    if (r.status === 200) return "ok";
    if (r.status === 410 || r.reason === "Unregistered") return "invalid";
    if (r.reason === "BadDeviceToken") continue;
    console.error("[nativePush] APNs send failed", r.status, r.reason);
    return "error";
  }
  return "invalid";
}

// ── Public ─────────────────────────────────────────────────────────────────

/** Send to every app install the user is signed in on. Never throws. */
export async function sendNativePushToUser(userId: string, payload: NativePushPayload): Promise<void> {
  const sa = serviceAccount();
  const jwt = apnsAuth();
  if (!sa && !jwt) return; // native push not configured

  const tokens = await prisma.nativePushToken.findMany({ where: { userId } });
  await Promise.all(
    tokens.map(async (t) => {
      try {
        let result: SendResult | null = null;
        if (t.platform === "android" && sa) result = await sendFcm(sa, t.token, payload);
        if (t.platform === "ios" && jwt) result = await sendApns(jwt, t.token, payload);
        if (result === "invalid") {
          await prisma.nativePushToken.delete({ where: { token: t.token } }).catch(() => {});
        }
      } catch (err) {
        console.error("[nativePush] send error", (err as Error).message);
      }
    })
  );
}
