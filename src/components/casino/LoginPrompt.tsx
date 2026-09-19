"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { useAuthModal } from "@/contexts/AuthModalContext";

interface LoginPromptProps {
  gameName: string;
  onClose: () => void;
}

export function LoginPrompt({ gameName, onClose }: LoginPromptProps) {
  const { openLogin, openRegister } = useAuthModal();

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function handleLogin() { onClose(); openLogin(); }
  function handleRegister() { onClose(); openRegister(); }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-[var(--bg-surface)] border border-[color:var(--border-accent)] rounded-2xl p-7 shadow-2xl animate-pop"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.6), var(--glow-gold)" }}
      >
        <button onClick={onClose} className="absolute top-3.5 right-3.5 p-1.5 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors">
          <X className="w-4 h-4" />
        </button>

        <div className="w-14 h-14 bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)] rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🎮</span>
        </div>

        <h2 className="font-display text-[color:var(--text-primary)] text-lg font-bold text-center mb-1">Play {gameName}</h2>
        <p className="text-[color:var(--text-secondary)] text-sm text-center mb-5">
          Create a free account or log in to start playing.
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={handleRegister}
            className="shine glow-gold w-full h-11 flex items-center justify-center bg-gold-grad text-[#09090B] font-bold rounded-xl text-sm transition-transform hover:scale-[1.02]"
          >
            Create Free Account
          </button>
          <button
            onClick={handleLogin}
            className="w-full h-11 flex items-center justify-center bg-[var(--bg-elevated)] hover:border-[color:var(--border-accent)] text-[color:var(--text-primary)] font-medium rounded-xl text-sm border border-[color:var(--border-base)] transition-colors"
          >
            Log In
          </button>
        </div>
      </div>
    </div>
  );
}
