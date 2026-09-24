"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

/*
 * In-person agent portal — /in-person-agent/<IN_PERSON_AGENT_SECRET>. Agents are normal users
 * (same NextAuth session, same balance/deposit/withdraw); this portal is only
 * a hidden login screen. The URL secret is verified against the API on mount —
 * a wrong secret renders a plain 404 so the portal stays undiscoverable.
 */
export default function AgentPortalLayout({ children }: { children: React.ReactNode }) {
  const { secret } = useParams<{ secret: string }>();
  const [state, setState] = useState<"checking" | "ok" | "bad">("checking");

  useEffect(() => {
    fetch("/api/agent/auth/check", { headers: { "x-agent-secret": secret } })
      .then((r) => setState(r.ok ? "ok" : "bad"))
      .catch(() => setState("bad"));
  }, [secret]);

  if (state === "checking") {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }

  if (state === "bad") {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <p className="text-[color:var(--text-muted)] text-sm">404 — Not found</p>
      </div>
    );
  }

  return <>{children}</>;
}
