import { NextRequest, NextResponse } from "next/server";
import { redis, TTL_SMS } from "@/lib/redis";
import { parseSms } from "@/lib/smsParser";
import { approveDeposit, type PendingDepositData, type AgentSmsData } from "@/lib/deposits";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  // Shared-secret auth — the mphone app must include this
  const secret = process.env.SMS_FORWARDER_SECRET;
  if (!secret || body.secret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawMessage: string = body.message ?? body.text ?? "";
  const senderAddress: string = body.sender ?? body.from ?? "";

  if (!rawMessage) {
    return NextResponse.json({ error: "No message body" }, { status: 400 });
  }

  const parsed = parseSms(rawMessage, senderAddress);

  // Reject outgoing-payment SMS — prevents users from sending a "sent" SMS
  // as proof of a deposit they never made.
  if (parsed.direction === "sent") {
    await redis.set(
      `sms:rejected:${Date.now()}`,
      JSON.stringify({ reason: "sent-direction", rawMessage, parsed }),
      "EX",
      TTL_SMS
    );
    return NextResponse.json({ ok: false, reason: "sent-direction" });
  }

  const ref = parsed.reference;

  // ── Already processed (idempotency) ─────────────────────────────────────────
  if (ref) {
    const used = await redis.get(`used:ref:${ref}`);
    if (used) return NextResponse.json({ ok: true, status: "already-processed" });
  }

  // ── Try to match an existing pending user deposit ────────────────────────────
  if (ref && parsed.amount !== null) {
    const pendingRaw = await redis.get(`pending:ref:${ref}`);
    if (pendingRaw) {
      const pending: PendingDepositData = JSON.parse(pendingRaw);
      const approved = await approveDeposit(
        pending.depositId,
        pending.userId,
        parsed.amount,
        ref
      );
      return NextResponse.json({ ok: true, status: approved ? "approved" : "already-processed" });
    }
  }

  // Fallback: match by amount + method — ONLY when no ref could be extracted.
  // It used to run for ref-carrying messages too, whenever `pending:ref:<ref>`
  // was missing — which is the normal case, since the agent's SMS arrives
  // before the player pastes their receipt. The message then matched whichever
  // unrelated player happened to hold the global amount bucket, credited them,
  // and burned this reference; the player who actually paid was told their
  // receipt had "already been processed". With a ref we store it below and let
  // the player claim it instead.
  if (!ref && parsed.amount !== null && parsed.method) {
    const amountKey = `pending:amount:${parsed.amount}:${parsed.method}`;
    const pendingRaw = await redis.get(amountKey);
    if (pendingRaw) {
      const pending: PendingDepositData = JSON.parse(pendingRaw);
      const approved = await approveDeposit(
        pending.depositId,
        pending.userId,
        parsed.amount,
        `amt-${pending.depositId}`
      );
      if (approved) await redis.del(amountKey);
      return NextResponse.json({ ok: true, status: approved ? "approved" : "already-processed" });
    }
  }

  // ── No pending match — store SMS for later user submission ───────────────────
  if (ref) {
    const smsData: AgentSmsData = {
      amount: parsed.amount ?? 0,
      method: parsed.method,
      rawMessage,
      receivedAt: new Date().toISOString(),
    };
    await redis.set(`sms:ref:${ref}`, JSON.stringify(smsData), "EX", TTL_SMS);
  } else {
    // Un-parseable — store raw for admin review
    await redis.set(
      `sms:raw:${Date.now()}`,
      JSON.stringify({ rawMessage, senderAddress, parsed }),
      "EX",
      TTL_SMS
    );
  }

  // Unmatched messages live only in Redis on a 24h TTL; admins review them at
  // /admin/<secret>/sms. There was an INSERT into an `agent_sms_log` table
  // here, swallowed by a try/catch "until the migration is run" — that
  // migration never existed, so it had always been a no-op.

  return NextResponse.json({ ok: true, status: "stored" });
}
