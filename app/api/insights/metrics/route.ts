import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveDateRange } from "@/lib/insights/dateRange";
import { getMetricBreakdown, resolveMetricIds } from "@/lib/insights/queries";

const querySchema = z.object({
  siteId: z.string().optional(),
  taskId: z.string().optional(),
  range: z.enum(["today", "last24h", "last7d", "last30d"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  let range;
  try {
    range = resolveDateRange(parsed.data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid range" }, { status: 400 });
  }

  const metricIds = await resolveMetricIds({ siteId: parsed.data.siteId, taskId: parsed.data.taskId });
  const rows = await getMetricBreakdown({ metricIds, from: range.from, to: range.to });

  return NextResponse.json({ items: rows });
}
