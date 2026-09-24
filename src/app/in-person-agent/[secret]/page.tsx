"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

/*
 * /agent/<secret> → already-authed agent goes straight to /sports,
 * everyone else lands on the portal login screen.
 */
export default function AgentPortalIndex() {
  const { secret } = useParams<{ secret: string }>();
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (session?.user?.role === "IN_PERSON_AGENT") {
      router.replace("/sports");
    } else {
      router.replace(`/in-person-agent/${secret}/login`);
    }
  }, [status, session, secret, router]);

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
    </div>
  );
}
