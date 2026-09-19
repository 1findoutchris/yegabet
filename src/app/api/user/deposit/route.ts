import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redis, TTL_PENDING } from "@/lib/redis";
import { parseSms } from "@/lib/smsParser";
import { approveDeposit, type PendingDepositData, type AgentSmsData } from "@/lib/deposits";
import { checkPaymentAmount } from "@/lib/paymentConfig";
import { z } from "zod";

const schema = z.object({
  method: z.enum(["telebirr", "cbebirr", "ebirr"]),
  amount: z.number().positive(),
  receiptText: z.string().min(10),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { method, amount, receiptText } = parsed.data;

  // The UI hides a disabled method and greys an out-of-range amount, but a
  // stale tab or a direct POST would otherwise still create a pending deposit
  // against a dead rail or outside the admin's limits.
  const rejection = await checkPaymentAmount(method, "deposit", amount);
  if (rejection) {
    return NextResponse.json({ error: rejection }, { status: 400 });
  }

  const userId = session.user.id;
  const sms = parseSms(receiptText);
  const ref = sms.reference;

  // ── Guard: this user already submitted this receipt ──────────────────────────
  // Runs BEFORE the global used-ref gate: a re-submit should get its own
  // deposit's status back, not a "someone else used this" error.
  if (ref) {
    const existing = await prisma.depositRequest.findFirst({
      where: { userId, smsRef: ref },
      select: { id: true, status: true },
    });
    if (existing) {
      return NextResponse.json({ status: existing.status, depositId: existing.id });
    }

    // ── Guard: the reference was consumed by a different user ─────────────────
    const used = await redis.get(`used:ref:${ref}`);
    if (used) {
      return NextResponse.json(
        { error: "This transaction has already been processed." },
        { status: 409 }
      );
    }
  }//nhjn

  // ── Try immediate match: agent SMS already in Redis ──────────────────────────
  if (ref) {
    const agentRaw = await redis.get(`sms:ref:${ref}`);
    if (agentRaw) {
      const agentSms: AgentSmsData = JSON.parse(agentRaw);
      const confirmedAmount = agentSms.amount > 0 ? agentSms.amount : amount;

      // Create the deposit request first (PENDING), then immediately approve it ioj
      const depositReq = await prisma.depositRequest.create({
        data: { userId, amount: confirmedAmount, method, receiptText, smsRef: ref, status: "PENDING" },
      });

      const approved = await approveDeposit(depositReq.id, userId, confirmedAmount, ref);
      return NextResponse.json({
        status: approved ? "APPROVED" : "PENDING",
        depositId: depositReq.id,
      });
    }
  }

  // ── No immediate match — create PENDING and wait for agent SMS ───────────────
  const depositReq = await prisma.depositRequest.create({
    data: { userId, amount, method, receiptText, smsRef: ref ?? null, status: "PENDING" },
  });

  const pendingData: PendingDepositData = {
    depositId: depositReq.id,
    userId,
    method,
    submittedAt: new Date().toISOString(),
  };

  // `pending:amount:*` is ONE global bucket per amount+method — every user
  // waiting on 100 birr via telebirr shares it, and the last writer wins. A
  // deposit that has a reference must never sit in it: an agent SMS could then
  // match this row on the amount alone, credit the wrong player, and burn the
  // real payer's reference — whose own receipt then came back "already
  // processed". With a ref, `pending:ref:*` is the only key that matches.
  //
  // ponytail: ref-less deposits still share the bucket, so two players waiting
  // on the same figure can still be confused for each other. Key on the
  // sender's phone (parseSms already returns it) if that ever bites.
  await redis.set(
    ref ? `pending:ref:${ref}` : `pending:amount:${amount}:${method}`,
    JSON.stringify(pendingData),
    "EX",
    TTL_PENDING
  );

  return NextResponse.json({ status: "PENDING", depositId: depositReq.id });
}
