"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Convert the base64url VAPID public key into the Uint8Array the Push API wants.
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator && "PushManager" in window)) return;
    setSupported(true);
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  async function subscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string
        ),
      });
      const res = await fetch("/api/user/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error();
      setSubscribed(true);
      toast.success("Notifications enabled");
    } catch {
      toast.error("Couldn't enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/user/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Notifications disabled");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <button
      onClick={subscribed ? unsubscribe : subscribe}
      disabled={busy}
      className="flex items-center gap-3 w-full rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 text-left hover:border-[color:var(--border-accent)] transition-colors disabled:opacity-60"
    >
      <div className="w-10 h-10 rounded-xl grid place-items-center bg-[#2DD4BF1A]">
        {busy ? (
          <Loader2 className="w-5 h-5 animate-spin text-[color:var(--gold)]" />
        ) : subscribed ? (
          <Bell className="w-5 h-5 text-[color:var(--gold)]" />
        ) : (
          <BellOff className="w-5 h-5 text-[color:var(--text-muted)]" />
        )}
      </div>
      <div>
        <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">
          Push notifications
        </p>
        <p className="text-[11px] text-[color:var(--text-muted)]">
          {subscribed
            ? "On — you'll be alerted on deposits & wins"
            : "Off — tap to get deposit & bonus alerts"}
        </p>
      </div>
    </button>
  );
}
