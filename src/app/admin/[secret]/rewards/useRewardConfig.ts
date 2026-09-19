"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminFetch } from "../useAdmin";

/**
 * Loads the whole reward config for one section page.
 *
 * Every section fetches the same small JSON blob rather than the API growing a
 * per-block read. Blocks already save independently, so there is nothing to
 * gain from splitting the read as well.
 */
export function useRewardConfig() {
  const adminFetch = useAdminFetch();
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch("/rewards");
      if (!res.ok) throw new Error();
      setConfig((await res.json()).config);
    } catch {
      setError("Failed to load reward config.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  return { config, loading, error, adminFetch, reload: load };
}
