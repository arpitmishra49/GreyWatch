"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StopButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleStop() {
    setLoading(true);
    try {
      await fetch(`/api/tasks/${taskId}/stop`, { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className="danger" onClick={handleStop} disabled={loading}>
      {loading ? "Stopping..." : "Stop"}
    </button>
  );
}
