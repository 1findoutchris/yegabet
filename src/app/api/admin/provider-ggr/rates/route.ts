import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { adminUsername, getClientIp, logAdminAction, requireAdminAuth } from "@/lib/adminAuth";
import { canEditRates, REPORT_TIMEZONE } from "@/lib/providerGgr";
import { dayIn, isNegativePolicy, PROVIDER_KEY, validRatePct } from "@/lib/providerGgrCore";

const schema = z.object({
  providerKey: z.string().regex(PROVIDER_KEY),
  ratePct: z.number().refine(validRatePct, "Percentage must be 0–100 with at most 2 decimals"),
  negativePolicy: z.string().refine(isNegativePolicy, "Unknown negative-GGR policy"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
});

/**
 * POST — add a new version of a provider's fee (rates are never edited in
 * place). Only admins in GGR_RATE_EDITORS may do this.
 *
 * Backdating changes figures for days already reported, so an effective date
 * before today needs a note saying why — it is never silent.
 */
export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const username = await adminUsername(req);
  if (!canEditRates(username)) {
    return NextResponse.json({ error: "Your admin account can't change provider fees." }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { providerKey, ratePct, negativePolicy, effectiveFrom, note } = parsed.data;
  if (Number.isNaN(Date.parse(effectiveFrom))) {
    return NextResponse.json({ error: "Invalid effective date" }, { status: 400 });
  }
  const today = dayIn(REPORT_TIMEZONE());
  if (effectiveFrom < today && !note) {
    return NextResponse.json(
      { error: "An effective date in the past recalculates days already reported — add a note explaining why." },
      { status: 400 },
    );
  }

  const row = await prisma.providerFeeRate.create({
    data: {
      providerKey,
      ratePct,
      negativePolicy,
      effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`),
      changedBy: username!,
      note: note || null,
    },
  });
  await logAdminAction({
    action: "SET_PROVIDER_FEE",
    targetId: providerKey,
    targetType: "ProviderFeeRate",
    note: note ?? undefined,
    ipAddress: getClientIp(req),
    metadata: { rateId: row.id, ratePct, negativePolicy, effectiveFrom, changedBy: username },
  });
  return NextResponse.json({ success: true, id: row.id });
}
