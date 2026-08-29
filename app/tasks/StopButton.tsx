"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StopButton({ taskId, kind = "tasks" }: { taskId: string; kind?: "tasks" | "email-tasks" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleStop() {
    setLoading(true);
    try {
      await fetch(`/api/${kind}/${taskId}/stop`, { method: "POST" });
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
