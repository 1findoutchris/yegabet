import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { telegramSignIn } from "@/lib/tgLink";

const loginSchema = z.object({
  phone: z.string().min(1),
  password: z.string().min(1),
  // Sent only by the in-person agent portal (/in-person-agent/<secret>/login).
  portalSecret: z.string().optional(),
});

/**
 * How long a session started from the Telegram Mini App lasts. Short on
 * purpose: the Mini App signs in again silently from fresh initData every time
 * it opens, so a long-lived cookie buys nothing there and costs exposure if
 * the WebView's storage leaks. Password sessions keep NextAuth's default.
 */
export const TELEGRAM_SESSION_TTL = 12 * 60 * 60;

const telegramSchema = z.object({ initData: z.string().min(1).max(8192) });

// Inlined rather than imported from agentAuth.ts, which imports this module.
function isAgentPortal(secret: string | undefined): boolean {
  const expected = process.env.IN_PERSON_AGENT_SECRET;
  return !!expected && secret === expected;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        phone: { label: "Phone", type: "text" },
        password: { label: "Password", type: "password" },
        portalSecret: { label: "Portal secret", type: "text" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { phone: parsed.data.phone },
        });

        if (!user || !user.isActive) return null;

        const passwordMatch = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!passwordMatch) return null;

        // In-person agents sign in ONLY through their secret portal, and the
        // portal signs in ONLY in-person agents. Same null (generic "incorrect"
        // error) either way, so neither login screen reveals the other exists.
        const isAgent = user.role === "IN_PERSON_AGENT";
        if (isAgent !== isAgentPortal(parsed.data.portalSecret)) return null;

        return {
          id: user.id,
          username: user.username,
          name: user.name ?? user.username,
          phone: user.phone,
          email: user.email ?? undefined,
          role: user.role,
        };
      },
    }),
    // Telegram Mini App. The browser hands over the raw initData Telegram
    // signed; identity comes ONLY from validating it here with the bot token.
    // A user id, phone or account id sent alongside would simply be ignored —
    // the schema doesn't even accept one.
    Credentials({
      id: "telegram",
      name: "Telegram",
      credentials: { initData: { label: "initData", type: "text" } },
      async authorize(credentials) {
        const parsed = telegramSchema.safeParse(credentials);
        if (!parsed.success) return null;

        // Null for a bad signature, a stale launch, or an unlinked, banned or
        // in-person-agent account (portal-only, as above).
        const user = await telegramSignIn(parsed.data.initData, process.env.TELEGRAM_VERIFY_BOT_TOKEN);
        if (!user) return null;

        return {
          id: user.id,
          username: user.username,
          name: user.name ?? user.username,
          phone: user.phone,
          email: user.email ?? undefined,
          role: user.role,
          via: "telegram",
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = (user as { username: string }).username;
        token.name = (user as { name?: string | null }).name ?? null;
        token.role = (user as { role: string }).role;
        token.phone = (user as { phone: string }).phone;
        // A fresh sign-in replaces whatever session was there, so a password
        // login after a Telegram one drops the short expiry and vice versa.
        if ((user as { via?: string }).via === "telegram") {
          token.via = "telegram";
          token.viaExp = Math.floor(Date.now() / 1000) + TELEGRAM_SESSION_TTL;
        } else {
          delete token.via;
          delete token.viaExp;
        }
      }
      // NextAuth re-signs the cookie on every read with a rolling expiry, so a
      // short maxAge alone would never lapse for an active user. A fixed
      // deadline in the token does; returning null clears the cookie.
      if (token.via === "telegram" && (typeof token.viaExp !== "number" || token.viaExp < Date.now() / 1000)) {
        return null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.username = token.username as string;
      session.user.name = (token.name as string | null) ?? token.username as string;
      session.user.role = token.role as string;
      session.user.phone = token.phone as string;
      return session;
    },
  },
  // Login is the AuthModal, not a page — send NextAuth's sign-in redirects to
  // the lobby, where the modal is mounted.
  pages: { signIn: "/casino" },
  session: { strategy: "jwt" },
  trustHost: true,
});
