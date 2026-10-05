"use client";

import { Search } from "lucide-react";
import { openSearch } from "./SearchOverlay";

/** A search field look-alike that opens the full search overlay. */
export function SearchTrigger({ className = "" }: { className?: string }) {
  return (
    <button
      onClick={openSearch}
      className={"group flex items-center gap-3 w-full h-12 pl-4 pr-2 rounded-full bg-[var(--v-bg-2)] border border-[color:var(--v-line-2)] text-left hover:border-[color:var(--v-teal-a24)] transition-colors " + className}
    >
      <Search className="w-4 h-4 text-[color:var(--v-text-3)] group-hover:text-[color:var(--v-teal)] transition-colors" />
      <span className="flex-1 text-[14px] text-[color:var(--v-text-3)] truncate">Search games, providers or categories</span>
      <span className="hidden sm:inline text-[11px] font-semibold text-[color:var(--v-text-3)] border border-[color:var(--v-line-2)] rounded-full px-2.5 py-1">Search</span>
    </button>
  );
}
