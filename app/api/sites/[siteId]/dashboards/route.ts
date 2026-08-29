import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listDashboards, resolveSiteGrafanaConfig } from "@/lib/grafana";

// Lists every dashboard on the site's Grafana instance — the first step of
// task creation once dashboard selection moves to task-level (Phase 7).
// A site is a Grafana instance, not a single fixed dashboard, so this can't
// just read site.dashboardUid.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await params;
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  try {
    const dashboards = await listDashboards(resolveSiteGrafanaConfig(site));
    return NextResponse.json(dashboards);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to list dashboards from Grafana: ${message}` }, { status: 502 });
  }
}
