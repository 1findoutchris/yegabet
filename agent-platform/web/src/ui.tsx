import { useCallback, useEffect, useState, type ReactNode } from "react";
import { copyText } from "./lib/clipboard";
import { formatSantim } from "./lib/money";

/** The current "#/…" route, e.g. "/agent/deposits". */
export function useRoute(): string {
  const read = () => window.location.hash.replace(/^#/, "") || "/";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

/** Load data on mount (and when `deps` change); `reload()` refetches. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    fn().then(
      (d) => live && setData(d),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  return { data, error, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/**
 * Runs an action once at a time (no double submit on money buttons) and keeps
 * its outcome message.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setDone(null);
      try {
        await fn();
        if (success) setDone(success);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );
  return { busy, error, done, run };
}

export function Notice({ error, done }: { error?: string | null; done?: string | null }) {
  if (error) return <div className="notice error">{error}</div>;
  if (done) return <div className="notice done">{done}</div>;
  return null;
}

export const Birr = ({ santim }: { santim: string }) => <>{formatSantim(santim)} ETB</>;

const TONE: Record<string, string> = {
  pending: "wait",
  requested: "wait",
  paid: "wait",
  escalated: "bad",
  disputed: "bad",
  draft: "wait",
  open: "wait",
  confirmed: "ok",
  completed: "ok",
  approved: "ok",
  active: "ok",
  rejected: "bad",
  declined: "bad",
  cancelled: "",
  expired: "",
  paused: "bad",
  closed: "",
  disabled: "",
};
export const Tag = ({ s }: { s: string }) => <span className={`tag ${TONE[s] ?? ""}`}>{s}</span>;

export function Tabs({ items, route }: { items: [string, string][]; route: string }) {
  return (
    <div className="tabs">
      {items.map(([href, label]) => (
        <a key={href} href={`#${href}`} className={route === href ? "on" : ""}>
          {label}
        </a>
      ))}
    </div>
  );
}

export const Panel = ({ title, children }: { title?: string; children: ReactNode }) => (
  <section className="panel">
    {title && <h2>{title}</h2>}
    {children}
  </section>
);

export function Loading({ error }: { error: string | null }) {
  return error ? <Notice error={error} /> : <p className="muted">Loading…</p>;
}

/** A copy button that says whether it worked; the text is shown too, so it can always be copied by hand. */
export function CopyButton({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const click = async () => {
    setState((await copyText(text)) ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <button className={state === "copied" ? "small" : "small ghost"} onClick={click}>
      {state === "copied" ? "✓ Copied" : state === "failed" ? "Copy failed: select the link below" : label}
    </button>
  );
}
