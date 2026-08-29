import { evaluateThreshold } from "./grafana";
import type { Operator } from "./types";
import type { EmailAttachment } from "./email";

export interface ReportMetricData {
  panelTitle: string;
  value: number | null;
  errorMessage?: string;
  operator: string | null;
  threshold: number | null;
  screenshot?: Buffer;
}

function operatorSymbol(operator: string): string {
  switch (operator) {
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
    case "eq":
      return "=";
    default:
      return operator;
  }
}

// Table-based layout with inline styles throughout — the only markup style
// that renders consistently across real-world email clients (no external
// or embedded <style> blocks).
export function renderReportEmail(params: {
  siteName: string;
  generatedAt: Date;
  metrics: ReportMetricData[];
}): { html: string; attachments: EmailAttachment[] } {
  const { siteName, generatedAt, metrics } = params;
  const attachments: EmailAttachment[] = [];

  const rows = metrics
    .map((m, i) => {
      if (m.errorMessage) {
        return `
          <tr>
            <td style="padding:14px 16px;border-bottom:1px solid #e5e1d8;font-family:Arial,sans-serif;font-size:14px;color:#171a1f;">${m.panelTitle}</td>
            <td style="padding:14px 16px;border-bottom:1px solid #e5e1d8;font-family:Arial,sans-serif;font-size:13px;color:#ab3b2a;" colspan="2">Could not read this metric: ${m.errorMessage}</td>
          </tr>`;
      }

      let statusHtml = "";
      if (m.operator && m.threshold !== null && m.value !== null) {
        const breached = evaluateThreshold(m.value, m.operator as Operator, m.threshold);
        const color = breached ? "#ab3b2a" : "#17766f";
        const label = breached ? "OVER THRESHOLD" : "within range";
        statusHtml = `<div style="font-family:'Courier New',monospace;font-size:11px;color:${color};margin-top:4px;">value ${operatorSymbol(m.operator)} ${m.threshold} &middot; ${label}</div>`;
      }

      let imageHtml = "";
      if (m.screenshot) {
        const cid = `metric-${i}`;
        attachments.push({ filename: `${cid}.png`, content: m.screenshot });
        imageHtml = `<div style="margin-top:10px;"><img src="cid:${cid}" width="480" style="max-width:100%;border-radius:6px;border:1px solid #e5e1d8;" alt="${m.panelTitle} chart"></div>`;
      }

      return `
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid #e5e1d8;font-family:Arial,sans-serif;font-size:14px;color:#171a1f;vertical-align:top;">
            <strong>${m.panelTitle}</strong>
            ${statusHtml}
            ${imageHtml}
          </td>
          <td style="padding:14px 16px;border-bottom:1px solid #e5e1d8;font-family:'Courier New',monospace;font-size:16px;color:#171a1f;text-align:right;vertical-align:top;">
            ${m.value}
          </td>
        </tr>`;
    })
    .join("");

  const html = `
    <div style="background:#f5f0e6;padding:32px 16px;font-family:Arial,sans-serif;">
      <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#fffdf9;border-radius:12px;overflow:hidden;border:1px solid #e5e1d8;">
        <tr>
          <td style="padding:24px 24px 16px;">
            <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:1px;color:#5f5b52;text-transform:uppercase;">GreyWatch report</div>
            <div style="font-size:22px;font-weight:bold;color:#171a1f;margin-top:6px;">${siteName}</div>
            <div style="font-size:12px;color:#5f5b52;margin-top:4px;">Generated ${generatedAt.toLocaleString()}</div>
          </td>
        </tr>
        <tr>
          <td>
            <table role="presentation" width="100%" style="border-collapse:collapse;">
              ${rows}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;font-family:Arial,sans-serif;font-size:11px;color:#8b8579;">
            This is a scheduled report from GreyWatch, not an alert — no action is required unless a value looks wrong to you.
          </td>
        </tr>
      </table>
    </div>`;

  return { html, attachments };
}
