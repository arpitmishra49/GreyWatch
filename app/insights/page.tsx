import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { InsightsDashboard } from "./InsightsDashboard";

export default async function InsightsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="shell-lg">
      <span className="eyebrow">
        <span className="dot" aria-hidden="true"></span>
        {user.username}
      </span>
      <h1>
        Insights<span className="accent-dot">.</span>
      </h1>
      <p className="subtitle">
        Operational health, SLA compliance, and breach history — derived from monitoring data already collected,
        aggregated in the background.
      </p>
      <InsightsDashboard />
    </div>
  );
}
