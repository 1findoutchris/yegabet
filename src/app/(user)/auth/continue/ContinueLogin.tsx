"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { VLoader } from "@/components/vinna/VLoader";
import { VMark } from "@/components/vinna/VMark";
import { useAuthModal } from "@/contexts/AuthModalContext";

/**
 * Exchanges the one-time handoff from the bot's "Continue on Website" link for
 * a normal session (the "handoff" provider in lib/auth.ts), then opens the
 * site's default page.
 *
 * The exchange happens here in the browser, never on the GET itself, so a link
 * scanner prefetching the URL can't use up the token. The token is wiped from
 * the address bar before anything else, so it doesn't linger in history.
 */
export function ContinueLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const { openLogin } = useAuthModal();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get("t") ?? "";
    window.history.replaceState(null, "", "/auth/continue");
    (async () => {
      const res = token ? await signIn("handoff", { token, redirect: false }).catch(() => null) : null;
      if (res && !res.error) router.replace("/casino");
      else setFailed(true);
    })();
  }, [params, router]);

  if (!failed) {
    return (
      <div className="min-h-[70vh] grid place-items-center">
        <VLoader size={72} label="Signing you in…" />
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-6 text-center max-w-sm mx-auto">
      <VMark size={56} />
      <h1 className="mt-5 text-[20px] font-extrabold text-white">This link has expired</h1>
      <p className="mt-2 text-[14px] text-[color:var(--v-text-2)]">
        Sign-in links work once and only for a few minutes. Your account is ready — log in with your phone number and password.
      </p>
      <button onClick={openLogin} className="v-btn v-btn-primary h-12 w-full mt-6">Log in</button>
    </div>
  );
}
