"use client";

import { useParams } from "next/navigation";

// Mirrors useAgentFetch: prefixes /api/payout and attaches the secret header
// from the URL. All payout-portal API calls go through this.
export function usePayoutFetch() {
  const { secret } = useParams<{ secret: string }>();

  return async function payoutFetch(path: string, init?: RequestInit) {
    return fetch(`/api/payout${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-payout-secret": secret,
        ...(init?.headers ?? {}),
      },
    });
  };
}
