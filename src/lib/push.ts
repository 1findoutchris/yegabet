import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { sendNativePushToUser } from "@/lib/nativePush";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT ?? "mailto:support@vinnabet.com";

if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Send a push notification to every device the user has subscribed: browsers
 * via Web Push, and the native apps via APNs/FCM (lib/nativePush). Expired
 * subscriptions (410/404) are pruned. Fire-and-forget: never throws to the caller.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  await Promise.all([sendWebPush(userId, payload), sendNativePushToUser(userId, payload)]);
}

async function sendWebPush(userId: string, payload: PushPayload): Promise<void> {
  if (!publicKey || !privateKey) return; // push not configured — no-op

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { endpoint: s.endpoint } }).catch(() => {});
        }
      }
    })
  );
}
