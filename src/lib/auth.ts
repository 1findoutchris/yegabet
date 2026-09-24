import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const loginSchema = z.object({
  phone: z.string().min(1),
  password: z.string().min(1),
  // Sent only by the in-person agent portal (/in-person-agent/<secret>/login).
  portalSecret: z.string().optional(),
});

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
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = (user as { username: string }).username;
        token.name = (user as { name?: string | null }).name ?? null;
        token.role = (user as { role: string }).role;
        token.phone = (user as { phone: string }).phone;
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
