import { NextResponse } from "next/server";
import { z } from "zod";
import { renderToBuffer } from "@react-pdf/renderer";
import { resolveDateRange } from "@/lib/insights/dateRange";
import { getBreachIncidents, getMetricBreakdown, getPeakAnalysis, getSummary, resolveMetricIds } from "@/lib/insights/queries";
import { ReportDocument } from "@/lib/insights/pdf/ReportDocument";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  siteId: z.string().optional(),
  range: z.enum(["today", "last24h", "last7d", "last30d"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

// A report this small (tens of metrics, at most a few hundred breach rows)
// renders in well under a second — synchronous generation is safe here per
// the "small reports can generate immediately" allowance. Revisit with a
// background job only if real report sizes grow enough to make this slow.
const MAX_BREACH_ROWS_IN_PDF = 500;

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

  const siteName = parsed.data.siteId
    ? ((await prisma.site.findUnique({ where: { id: parsed.data.siteId }, select: { name: true } }))?.name ?? "Unknown site")
    : "All Sites";

  const metricIds = await resolveMetricIds({ siteId: parsed.data.siteId });

  const [summary, metrics, peak, breachPage] = await Promise.all([
    getSummary({ metricIds, from: range.from, to: range.to }),
    getMetricBreakdown({ metricIds, from: range.from, to: range.to }),
    getPeakAnalysis({ metricIds, from: range.from, to: range.to }),
    getBreachIncidents({ metricIds, from: range.from, to: range.to, page: 1, pageSize: MAX_BREACH_ROWS_IN_PDF }),
  ]);

  const buffer = await renderToBuffer(
    ReportDocument({
      siteName,
      from: range.from,
      to: range.to,
      generatedAt: new Date(),
      summary,
      metrics,
      breaches: breachPage.items,
      peak,
    }),
  );

  const filename = `greywatch-insights-${siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${range.from.toISOString().slice(0, 10)}-to-${range.to.toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
