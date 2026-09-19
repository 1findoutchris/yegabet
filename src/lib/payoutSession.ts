import { redis } from "./redis";
import crypto from "crypto";

// Payout-agent sessions — same Redis-cookie pattern as adminSession/agentSession,
// but its own namespace and cookie so payout agents, cashier agents, admins and
// players can never share a session. The value is the WithdrawalAgent id.
export const PAYOUT_COOKIE = "fetan_payout";
const SESSION_TTL = 8 * 60 * 60; // 8 hours

export async function createPayoutSession(agentId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await redis.set(`payout:session:${token}`, agentId, "EX", SESSION_TTL);
  return token;
}

export async function verifyPayoutSession(token: string): Promise<string | null> {
  if (!token) return null;
  return (await redis.get(`payout:session:${token}`)) ?? null;
}

export async function deletePayoutSession(token: string): Promise<void> {
  await redis.del(`payout:session:${token}`);
}
