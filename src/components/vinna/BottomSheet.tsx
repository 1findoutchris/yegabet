"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A sheet that slides up from the bottom on phones and sits as a centred panel
 * from sm up. Escape and a backdrop tap close it; the page behind it does not
 * scroll while it is open.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(0,0,0,0.62)] backdrop-blur-[2px] v-fade-in cursor-default"
      />
      <div
        className={cn(
          "relative w-full sm:max-w-md max-h-[88vh] overflow-y-auto",
          "rounded-t-[24px] sm:rounded-[22px] bg-[var(--v-bg-2)] border border-[color:var(--v-line-2)]",
          "shadow-[var(--v-shadow-3)] v-sheet",
          "pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-5",
          className
        )}
      >
        {/* grab handle */}
        <div className="sm:hidden flex justify-center pt-2.5">
          <span className="h-1 w-10 rounded-full bg-[var(--v-line-2)]" />
        </div>
        <div className="flex items-center gap-3 px-5 pt-3 sm:pt-5 pb-2">
          <div className="min-w-0 flex-1 text-[17px] font-bold text-white">{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 grid place-items-center rounded-full bg-[var(--v-bg-3)] text-[color:var(--v-text-2)] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
