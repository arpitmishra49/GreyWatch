import { redirect } from "next/navigation";

// Retired: task creation is site-scoped now (Grafana dashboard discovery
// needs a specific site's instance to query). Anyone with this URL
// bookmarked gets sent to pick a site first, rather than a dead link.
export default function LegacyNewTaskRedirect() {
  redirect("/");
}
