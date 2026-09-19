"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, Layers, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  providers: { slug: string; name: string; count: number }[];
  /** Currently active provider slug, if the lobby is filtered to one. */
  activeSlug?: string;
}

export function ProviderSelect({ providers, activeSlug }: Props) {
  const router = useRouter();
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = providers.find((p) => p.slug === activeSlug);
  const filtered = providers.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  function pick(slug: string) {
    setOpen(false);
    router.push(`/casino/${slug}`);
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 whitespace-nowrap px-3.5 py-[7px] rounded-lg text-[12px] font-medium transition-all duration-150",
          "bg-[var(--bg-surface)] border",
          open || active
            ? "border-[color:var(--border-accent)] text-[color:var(--text-primary)]"
            : "border-[color:var(--border-base)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)]"
        )}
      >
        <Layers className="w-3.5 h-3.5 text-[color:var(--gold)]" />
        {active ? active.name : "Select provider"}
        <ChevronDown
          className={cn("w-3.5 h-3.5 transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[260px] rounded-xl border border-[color:var(--border-base)] bg-[var(--bg-elevated)] shadow-[0_18px_40px_rgba(0,0,0,0.55)] overflow-hidden animate-pop origin-top-right"
        >
          {/* Search */}
          <div className="p-2 border-b border-[color:var(--border-muted)]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[color:var(--border-base)]">
              <Search className="w-3.5 h-3.5 text-[color:var(--text-muted)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search providers…"
                className="w-full bg-transparent text-[12px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] outline-none"
              />
            </div>
          </div>

          {/* List */}
          <div className="max-h-[280px] overflow-y-auto scrollbar-hide py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-[12px] text-[color:var(--text-muted)]">
                No providers found
              </p>
            )}
            {filtered.map((p) => {
              const isActive = p.slug === activeSlug;
              return (
                <button
                  key={p.slug}
                  onClick={() => pick(p.slug)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                    isActive
                      ? "bg-[var(--bg-accent-dim)] text-[color:var(--gold)]"
                      : "text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[color:var(--text-primary)]"
                  )}
                >
                  <span className="text-[13px] font-medium truncate flex-1">{p.name}</span>
                  <span className="text-[11px] text-[color:var(--text-muted)] tabular-nums">{p.count}</span>
                  {isActive && <Check className="w-3.5 h-3.5" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
