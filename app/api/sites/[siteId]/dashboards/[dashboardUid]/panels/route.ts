import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPanels, resolveSiteGrafanaConfig } from "@/lib/grafana";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteId: string; dashboardUid: string }> },
) {
  const { siteId, dashboardUid } = await params;
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  try {
    const panels = await getPanels(resolveSiteGrafanaConfig(site), dashboardUid);
    return NextResponse.json(panels);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to fetch panels from Grafana: ${message}` }, { status: 502 });
  }
}
