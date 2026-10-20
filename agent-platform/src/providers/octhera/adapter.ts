import { createHmac, timingSafeEqual } from "node:crypto";
import type { WalletCall, WalletResult } from "../gameWallet";

/**
 * Octhera API v2 company wallet: what was learned on the old YegaBet site,
 * applied to the new ledger. Octhera POSTs signed JSON and must always get
 * HTTP 200 + JSON within 3 s, or a debit becomes a rollback.
 */

export const PROVIDER = "octhera";
export const MAX_SKEW_S = 300;
/** Octhera's playerId for our player N. Never changes once a player has played. */
export const PLAYER_PREFIX = "yb_";

export const toProviderPlayerId = (id: bigint): string => `${PLAYER_PREFIX}${id}`;

export function fromProviderPlayerId(v: unknown): bigint | null {
  if (typeof v !== "string") return null;
  const m = /^yb_(\d{1,18})$/.exec(v);
  return m ? BigInt(m[1] as string) : null;
}

/**
 * X-Octhera-Timestamp within 300 s, and any `v1=<hex>` in X-Octhera-Signature
 * equal to HMAC-SHA256(secret, timestamp + "." + raw body). Two signatures
 * arrive during a secret rotation; either may match.
 */
export function verifySignature(
  rawBody: string,
  timestamp: string,
  header: string,
  secret: string | undefined,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowS - Number(timestamp)) > MAX_SKEW_S) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  return header
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1="))
    .some((s) => {
      const got = Buffer.from(s.slice(3).toLowerCase());
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}

/**
 * Birr (a JSON number, at most two decimals) → santim. The ×100 is checked to
 * land on a whole number, so no float error can slip into the ledger.
 */
export function santim(v: unknown): bigint | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e13) return null;
  const cents = Math.round(v * 100);
  if (Math.abs(v * 100 - cents) > 1e-6) return null;
  return BigInt(cents);
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v.slice(0, 200) : null);

export type Parsed = { kind: "ping" } | { kind: "call"; call: WalletCall } | { kind: "invalid"; why: string };

/** Octhera's JSON → a WalletCall (or why it can't be one). */
export function parse(raw: unknown, currency: string): Parsed {
  if (!raw || typeof raw !== "object") return { kind: "invalid", why: "body is not an object" };
  const b = raw as Record<string, unknown>;
  if (b.type === "ping") return { kind: "ping" };
  if (b.version !== 2) return { kind: "invalid", why: "version must be 2" };
  if (b.type !== "debit" && b.type !== "credit" && b.type !== "rollback") {
    return { kind: "invalid", why: `type ${String(b.type)}` };
  }
  const txnId = str(b.txnId);
  const bet = santim(b.betAmount);
  const win = santim(b.winAmount);
  if (!txnId || bet === null || win === null) return { kind: "invalid", why: "txnId / amounts" };
  if (b.currency !== currency)
    return { kind: "invalid", why: `currency ${String(b.currency)}, this site uses ${currency}` };
  const action = b.action ?? null;
  if (b.type === "debit" && action !== "bet" && action !== "bet_win")
    return { kind: "invalid", why: "debit action" };
  if (b.type === "credit" && action !== "win" && action !== "refund")
    return { kind: "invalid", why: "credit action" };
  return {
    kind: "call",
    call: {
      provider: PROVIDER,
      type: b.type,
      txnId,
      playerId: fromProviderPlayerId(b.playerId),
      bet,
      win,
      action: b.type === "rollback" ? null : (action as WalletCall["action"]),
      gameUid: str(b.gameUid),
      gameRound: str(b.gameRound),
      payload: raw,
    },
  };
}

export interface OctheraAnswer {
  status: "ok" | "error";
  code?: string;
  balance?: number;
}

/** Santim → Octhera's birr number (display only; the ledger keeps santim). */
const birr = (s: bigint): number => Number(s) / 100;

export function answer(r: WalletResult): OctheraAnswer {
  const out: OctheraAnswer = r.ok ? { status: "ok" } : { status: "error", code: r.code };
  if (r.balance !== undefined) out.balance = birr(r.balance);
  return out;
}

export const error = (code: string): OctheraAnswer => ({ status: "error", code });
