"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Task status changes in the background (the worker updates rows on its own
// schedule), so this page polls for fresh data rather than requiring a
// manual reload.
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
