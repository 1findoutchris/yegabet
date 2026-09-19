import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { getMergedMethods, setAgentOverride, setMethodToggles } from "@/lib/paymentConfig";
import { PAYMENT_METHODS, type MethodId } from "@/components/account/paymentMethods";
import { z } from "zod";

const VALID_IDS = PAYMENT_METHODS.map((m) => m.id) as [MethodId, ...MethodId[]];

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const methods = await getMergedMethods();
  return NextResponse.json({
    methods: methods.map((m) => ({
      id: m.id,
      name: m.name,
      desc: m.desc,
      logo: m.logo,
      accent: m.accent,
      agentLabel: m.agentLabel,
      agentNumber: m.agentNumber,
      agentName: m.agentName,
      depositEnabled: m.depositEnabled,
      withdrawEnabled: m.withdrawEnabled,
      minDeposit: m.minDeposit,
      maxDeposit: m.maxDeposit,
      minWithdraw: m.minWithdraw,
      maxWithdraw: m.maxWithdraw,
    })),
  });
}

const toggleSchema = z.object({
  id: z.enum(VALID_IDS),
  depositEnabled: z.boolean().optional(),
  withdrawEnabled: z.boolean().optional(),
});

// Availability is a PATCH so it saves on click, independent of the agent-detail
// form — taking a rail down shouldn't require filling in an account number.
export async function PATCH(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id, ...toggles } = parsed.data;
  if (toggles.depositEnabled === undefined && toggles.withdrawEnabled === undefined) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  await setMethodToggles(id, toggles);

  await logAdminAction({
    action: "TOGGLE_PAYMENT_METHOD",
    targetId: id,
    targetType: "PaymentMethod",
    note: Object.entries(toggles).map(([k, v]) => `${k}=${v}`).join(" "),
    ipAddress: getClientIp(req),
    metadata: { id, ...toggles },
  });

  return NextResponse.json({ success: true });
}

// Limits are whole ETB. min > max would silently close the rail while the
// toggle still says "on", so it's rejected rather than stored.
const etb = z.number().int().min(1).max(10_000_000);
const schema = z.object({
  id: z.enum(VALID_IDS),
  agentNumber: z.string().trim().min(1).max(60),
  agentName: z.string().trim().min(1).max(80),
  minDeposit: etb,
  maxDeposit: etb,
  minWithdraw: etb,
  maxWithdraw: etb,
})
  .refine((v) => v.minDeposit <= v.maxDeposit, {
    message: "Minimum deposit cannot exceed the maximum",
    path: ["minDeposit"],
  })
  .refine((v) => v.minWithdraw <= v.maxWithdraw, {
    message: "Minimum withdrawal cannot exceed the maximum",
    path: ["minWithdraw"],
  });

export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { id, ...data } = parsed.data;
  await setAgentOverride(id, data);

  await logAdminAction({
    action: "UPDATE_PAYMENT_AGENT",
    targetId: id,
    targetType: "PaymentMethod",
    note: `${data.agentName} · ${data.agentNumber} · dep ${data.minDeposit}-${data.maxDeposit} · wd ${data.minWithdraw}-${data.maxWithdraw}`,
    ipAddress: getClientIp(req),
    metadata: { id, ...data },
  });

  return NextResponse.json({ success: true });
}
