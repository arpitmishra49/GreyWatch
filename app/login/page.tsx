"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [slackUserId, setSlackUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, slackUserId }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Login failed");
      }
      router.push("/tasks");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="card">
        <span className="eyebrow">
          <span className="dot" aria-hidden="true"></span>
          GreyWatch access
        </span>
        <h1>
          Log in<span className="accent-dot">.</span>
        </h1>
        <p className="subtitle">
          No password — this is just enough to attribute tasks and route Slack
          DMs to the right teammate.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. arpit"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="slackUserId">Slack member ID</label>
            <input
              id="slackUserId"
              value={slackUserId}
              onChange={(e) => setSlackUserId(e.target.value)}
              placeholder="e.g. U0123ABC456"
              required
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Logging in..." : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
