import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { listSmsDevices, setSmsDevice } from "@/lib/sms";
import { z } from "zod";

/* The OTP handsets (SMS Gate phones) and their on/off switch. The phones
   themselves live in env — this only decides which of them registration codes
   may be routed through. */

export async function GET(req: NextRequest) {
  const auth = await requireAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ devices: await listSmsDevices() });
}

const schema = z.object({
  label: z.string().min(1),
  enabled: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { label, enabled } = parsed.data;

  // Only a handset that actually exists in env can be switched, so a stale tab
  // can't create rows for phones that were removed.
  const devices = await listSmsDevices();
  if (!devices.some((d) => d.label === label)) {
    return NextResponse.json({ error: "Unknown device" }, { status: 404 });
  }

  // Turning off the last live handset stops registration entirely. Allowed —
  // sometimes every phone really is down — but never silently.
  const remaining = devices.filter((d) => (d.label === label ? enabled : d.enabled)).length;

  await setSmsDevice(label, enabled);
  await logAdminAction({
    action: enabled ? "ENABLE_OTP_DEVICE" : "DISABLE_OTP_DEVICE",
    targetId: label,
    targetType: "SmsDevice",
    ipAddress: getClientIp(req),
    metadata: { remaining },
  });

  return NextResponse.json({ success: true, remaining });
}
