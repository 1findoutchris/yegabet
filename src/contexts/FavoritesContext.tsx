"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

interface FavoritesContextType {
  favorites: Set<string>;
  isFavorite: (gameId: string) => boolean;
  toggle: (gameId: string) => void;
  ready: boolean;
}

const FavoritesContext = createContext<FavoritesContextType>({
  favorites: new Set(),
  isFavorite: () => false,
  toggle: () => {},
  ready: false,
});

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  // Hydrate the favourite-id set once the user is known.
  useEffect(() => {
    if (status !== "authenticated") {
      setFavorites(new Set());
      setReady(status === "unauthenticated");
      return;
    }
    let cancelled = false;
    fetch("/api/user/favorites")
      .then((r) => (r.ok ? r.json() : { ids: [] }))
      .then((d: { ids?: string[] }) => {
        if (!cancelled) {
          setFavorites(new Set(d.ids ?? []));
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites]);

  const toggle = useCallback(
    (gameId: string) => {
      if (status !== "authenticated") return;
      const next = !favorites.has(gameId);

      // Optimistic update — flip immediately, reconcile on response.
      setFavorites((prev) => {
        const s = new Set(prev);
        if (next) s.add(gameId);
        else s.delete(gameId);
        return s;
      });

      fetch("/api/user/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, favorite: next }),
      })
        .then((r) => {
          if (!r.ok) throw new Error("failed");
        })
        .catch(() => {
          // Revert on failure.
          setFavorites((prev) => {
            const s = new Set(prev);
            if (next) s.delete(gameId);
            else s.add(gameId);
            return s;
          });
          toast.error("Couldn't update favorites — try again");
        });
    },
    [favorites, status]
  );

  return (
    <FavoritesContext.Provider value={{ favorites, isFavorite, toggle, ready }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export const useFavorites = () => useContext(FavoritesContext);
