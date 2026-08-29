import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatDuration, formatPercent } from "@/app/insights/format";
import type { InsightsSummary, MetricBreakdownRow, BreachIncidentRow, PeakAnalysis } from "@/lib/insights/queries";

// GreyWatch brand colors, kept consistent with app/globals.css's dark-theme
// tokens rather than reinventing a separate PDF palette. PDFs render on a
// white page by convention (printable, no dark background), so ink/accent
// colors are reused against white rather than the app's dark surfaces.
const INK = "#1b1a17";
const SLATE = "#5f5b52";
const DANGER = "#ab3b2a";
const SUCCESS = "#3f7d4a";
const LINE = "#dedad2";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, color: INK, fontFamily: "Helvetica" },
  eyebrow: { fontSize: 8, color: SLATE, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: SLATE, marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginTop: 18, marginBottom: 8, borderBottom: `1px solid ${LINE}`, paddingBottom: 4 },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 4 },
  kpiCard: { width: 150, border: `1px solid ${LINE}`, borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 7.5, color: SLATE, textTransform: "uppercase", marginBottom: 4 },
  kpiValue: { fontSize: 16, fontWeight: 700 },
  table: { display: "flex", width: "100%" },
  tableHeaderRow: { flexDirection: "row", borderBottom: `1px solid ${INK}`, paddingBottom: 4, marginBottom: 4 },
  tableRow: { flexDirection: "row", borderBottom: `0.5px solid ${LINE}`, paddingVertical: 4 },
  th: { fontSize: 7.5, fontWeight: 700, textTransform: "uppercase", color: SLATE },
  td: { fontSize: 8.5 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7.5, color: SLATE, flexDirection: "row", justifyContent: "space-between" },
});

function col(width: number) {
  return { width: `${width}%`, paddingRight: 4 };
}

export function ReportDocument({
  siteName,
  from,
  to,
  generatedAt,
  summary,
  metrics,
  breaches,
  peak,
}: {
  siteName: string;
  from: Date;
  to: Date;
  generatedAt: Date;
  summary: InsightsSummary;
  metrics: MetricBreakdownRow[];
  breaches: BreachIncidentRow[];
  peak: PeakAnalysis;
}) {
  const slaColor = (summary.slaCompliancePercentage ?? 100) < 99 ? DANGER : SUCCESS;

  return (
    <Document title={`GreyWatch Insights — ${siteName}`}>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.eyebrow}>GreyWatch Insights Report</Text>
        <Text style={styles.title}>{siteName}</Text>
        <Text style={styles.subtitle}>
          Period: {from.toLocaleDateString()} – {to.toLocaleDateString()} · Generated {generatedAt.toLocaleString()}
        </Text>

        <Text style={styles.sectionTitle}>Executive Summary</Text>
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Health</Text>
            <Text style={styles.kpiValue}>{formatPercent(summary.healthPercentage)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>SLA Compliance</Text>
            <Text style={[styles.kpiValue, { color: slaColor }]}>{formatPercent(summary.slaCompliancePercentage)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Breaches</Text>
            <Text style={[styles.kpiValue, summary.totalBreaches > 0 ? { color: DANGER } : {}]}>{summary.totalBreaches}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Avg Breach Duration</Text>
            <Text style={styles.kpiValue}>{formatDuration(summary.avgBreachDurationSec)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Longest Breach</Text>
            <Text style={styles.kpiValue}>{formatDuration(summary.longestBreachSec)}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Unmonitored Time</Text>
            <Text style={styles.kpiValue}>{formatDuration(summary.unmonitoredSeconds)}</Text>
          </View>
        </View>
        <Text style={{ fontSize: 8, color: SLATE, marginTop: 6 }}>
          Health% reflects monitored time only. SLA Compliance is measured against the full reporting period —
          unmonitored time counts against compliance rather than being assumed healthy.
        </Text>

        <Text style={styles.sectionTitle}>Peak Period Analysis</Text>
        <Text style={{ fontSize: 8.5, marginBottom: 6 }}>Peak window: {peak.peakWindowDescription}</Text>
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Peak Breaches</Text>
            <Text style={styles.kpiValue}>{peak.peakBreachCount}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Off-Peak Breaches</Text>
            <Text style={styles.kpiValue}>{peak.offPeakBreachCount}</Text>
          </View>
        </View>
        {peak.bySite.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.th, col(50)]}>Site</Text>
              <Text style={[styles.th, col(25)]}>Peak Breaches</Text>
              <Text style={[styles.th, col(25)]}>SLA Met (Peak)</Text>
            </View>
            {peak.bySite.map((s) => (
              <View style={styles.tableRow} key={s.siteId} wrap={false}>
                <Text style={[styles.td, col(50)]}>{s.siteName}</Text>
                <Text style={[styles.td, col(25)]}>{s.peakBreachCount}</Text>
                <Text style={[styles.td, col(25), { color: s.metSlaDuringPeak ? SUCCESS : DANGER }]}>
                  {s.metSlaDuringPeak ? "Yes" : "No"}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Metric Breakdown</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.th, col(22)]}>Site</Text>
            <Text style={[styles.th, col(28)]}>Panel</Text>
            <Text style={[styles.th, col(14)]}>Current</Text>
            <Text style={[styles.th, col(12)]}>Breaches</Text>
            <Text style={[styles.th, col(12)]}>Healthy %</Text>
            <Text style={[styles.th, col(12)]}>Longest</Text>
          </View>
          {metrics.map((m) => (
            <View style={styles.tableRow} key={m.metricId} wrap={false}>
              <Text style={[styles.td, col(22)]}>{m.siteName}</Text>
              <Text style={[styles.td, col(28)]}>{m.panelTitle}</Text>
              <Text style={[styles.td, col(14), m.currentStatus === "breached" ? { color: DANGER } : {}]}>
                {m.currentStatus ?? "—"}
              </Text>
              <Text style={[styles.td, col(12)]}>{m.breachCount}</Text>
              <Text style={[styles.td, col(12)]}>{formatPercent(m.healthyPercentage)}</Text>
              <Text style={[styles.td, col(12)]}>{formatDuration(m.longestBreachSec)}</Text>
            </View>
          ))}
          {metrics.length === 0 && <Text style={{ fontSize: 8.5, color: SLATE, marginTop: 4 }}>No metrics in scope.</Text>}
        </View>

        <Text style={styles.sectionTitle}>Breach Incidents ({breaches.length})</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.th, col(18)]}>Site</Text>
            <Text style={[styles.th, col(24)]}>Metric</Text>
            <Text style={[styles.th, col(20)]}>Started</Text>
            <Text style={[styles.th, col(20)]}>Recovered</Text>
            <Text style={[styles.th, col(18)]}>Duration</Text>
          </View>
          {breaches.map((b) => (
            <View style={styles.tableRow} key={b.id} wrap={false}>
              <Text style={[styles.td, col(18)]}>{b.siteName}</Text>
              <Text style={[styles.td, col(24)]}>{b.panelTitle}</Text>
              <Text style={[styles.td, col(20)]}>{new Date(b.startedAt).toLocaleString()}</Text>
              <Text style={[styles.td, col(20), b.endedAt ? {} : { color: DANGER }]}>
                {b.endedAt ? new Date(b.endedAt).toLocaleString() : "Ongoing"}
              </Text>
              <Text style={[styles.td, col(18)]}>{formatDuration(b.durationSec)}</Text>
            </View>
          ))}
          {breaches.length === 0 && <Text style={{ fontSize: 8.5, color: SLATE, marginTop: 4 }}>No breach incidents in this period.</Text>}
        </View>

        <View style={styles.footer} fixed>
          <Text>GreyWatch — GreyOrange internal monitoring platform</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
