"use client";

import { useParams } from "next/navigation";

export function useAdminFetch() {
  const { secret } = useParams<{ secret: string }>();

  return async function adminFetch(path: string, init?: RequestInit) {
    return fetch(`/api/admin${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": secret,
        ...(init?.headers ?? {}),
      },
    });
  };
}
