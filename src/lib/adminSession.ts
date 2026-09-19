import { redis } from "./redis";
import crypto from "crypto";

export const ADMIN_COOKIE = "fetan_admin";
const SESSION_TTL = 8 * 60 * 60; // 8 hours

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createAdminSession(username: string): Promise<string> {
  const token = generateSessionToken();
  await redis.set(`admin:session:${token}`, username, "EX", SESSION_TTL);
  return token;
}

export async function verifyAdminSession(token: string): Promise<string | null> {
  if (!token) return null;
  const username = await redis.get(`admin:session:${token}`);
  return username ?? null;
}

export async function deleteAdminSession(token: string): Promise<void> {
  await redis.del(`admin:session:${token}`);
}
