import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { redis } from "@/lib/redis";

/* Unmatched agent SMS parked in Redis by /api/sms/inbound. Three families, all
   on a 24h TTL, so this view is inherently a rolling window — anything older
   has already expired on its own, and Redis is the only record there is. */

const FAMILIES = {
  "sms:ref:": {
    kind: "unmatched",
    label: "Parsed, no matching deposit",
  },
  "sms:raw:": {
    kind: "unparsed",
    label: "Could not be parsed",
  },
  "sms:rejected:": {
    kind: "rejected",
    label: "Rejected (outgoing payment)",
  },
} as const;

const PREFIXES = Object.keys(FAMILIES) as (keyof typeof FAMILIES)[];

/** A key is deletable only if it belongs to one of the SMS families above. */
function allowedKey(key: string): boolean {
  return PREFIXES.some((p) => key.startsWith(p) && key.length > p.length);
}

const MAX_KEYS = 500;

/** SCAN rather than KEYS — KEYS blocks the whole Redis server. */
async function scanKeys(pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = next;
    found.push(...batch);
  } while (cursor !== "0" && found.length < MAX_KEYS);
  return found.slice(0, MAX_KEYS);
}

interface SmsRow {
  key: string;
  kind: string;
  label: string;
  ref: string | null;
  amount: number | null;
  method: string | null;
  sender: string | null;
  rawMessage: string;
  reason: string | null;
  receivedAt: string | null;
  ttlSeconds: number;
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const keys = (await Promise.all(PREFIXES.map((p) => scanKeys(`${p}*`)))).flat();
  if (keys.length === 0) return NextResponse.json({ messages: [] });

  // One round trip for the values, one for the TTLs.
  const values = await redis.mget(...keys);
  const ttlPipe = redis.pipeline();
  for (const k of keys) ttlPipe.ttl(k);
  const ttls = await ttlPipe.exec();

  const messages: SmsRow[] = keys.flatMap((key, i) => {
    const raw = values[i];
    if (!raw) return []; // expired between the scan and the read

    const prefix = PREFIXES.find((p) => key.startsWith(p))!;
    const family = FAMILIES[prefix];

    let parsedValue: Record<string, unknown> = {};
    try {
      parsedValue = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Shouldn't happen, but a malformed value must not hide the whole list.
      parsedValue = { rawMessage: raw };
    }
    // sms:raw / sms:rejected nest the parse result; sms:ref is flat.
    const inner = (parsedValue.parsed ?? {}) as Record<string, unknown>;

    return [{
      key,
      kind: family.kind,
      label: family.label,
      ref: (inner.reference as string) ?? (key.startsWith("sms:ref:") ? key.slice(prefix.length) : null),
      amount: (parsedValue.amount as number) ?? (inner.amount as number) ?? null,
      method: (parsedValue.method as string) ?? (inner.method as string) ?? null,
      sender: (parsedValue.senderAddress as string) ?? null,
      rawMessage: (parsedValue.rawMessage as string) ?? "",
      reason: (parsedValue.reason as string) ?? null,
      receivedAt: (parsedValue.receivedAt as string) ?? null,
      ttlSeconds: Number(ttls?.[i]?.[1] ?? -1),
    }];
  });

  // Newest first where we know the time; keys carry a ms timestamp otherwise.
  messages.sort((a, b) => (b.receivedAt ?? b.key).localeCompare(a.receivedAt ?? a.key));

  return NextResponse.json({ messages });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const key = req.nextUrl.searchParams.get("key");
  const all = req.nextUrl.searchParams.get("all") === "1";

  if (all) {
    const keys = (await Promise.all(PREFIXES.map((p) => scanKeys(`${p}*`)))).flat();
    if (keys.length > 0) await redis.del(...keys);
    await logAdminAction({
      action: "CLEAR_UNMATCHED_SMS", targetType: "Redis",
      note: `${keys.length} message(s)`, ipAddress: getClientIp(req),
      metadata: { count: keys.length },
    });
    return NextResponse.json({ success: true, deleted: keys.length });
  }

  // Whitelist the prefix rather than trusting the caller. Without this the
  // parameter would delete ANY Redis key — pending deposits, admin sessions,
  // OTP codes — from a route whose job is only to clear SMS.
  if (!key || !allowedKey(key)) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  const deleted = await redis.del(key);
  await logAdminAction({
    action: "DELETE_UNMATCHED_SMS", targetId: key, targetType: "Redis",
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ success: true, deleted });
}
