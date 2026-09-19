"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";

export function useAdminFetch() {
  const { secret } = useParams<{ secret: string }>();

  // Memoized — a fresh function identity every render would make any
  // useCallback/useEffect depending on adminFetch refire in a loop.
  return useCallback(
    async function adminFetch(path: string, init?: RequestInit) {
      return fetch(`/api/admin${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": secret,
          ...(init?.headers ?? {}),
        },
      });
    },
    [secret]
  );
}
