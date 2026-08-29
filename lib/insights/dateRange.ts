export interface ResolvedRange {
  from: Date;
  to: Date;
}

export type RangePreset = "today" | "last24h" | "last7d" | "last30d";

// Shared by every Insights API route so "today" / "last 7 days" / a custom
// from-to pair always mean the same thing everywhere in the module.
export function resolveDateRange(params: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): ResolvedRange {
  const now = new Date();

  if (params.from || params.to) {
    const from = params.from ? new Date(params.from) : new Date(now.getTime() - 7 * 86400_000);
    const to = params.to ? new Date(params.to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new Error("Invalid custom date range");
    }
    return { from, to };
  }

  const preset = (params.range as RangePreset) ?? "last7d";
  switch (preset) {
    case "today": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return { from: start, to: now };
    }
    case "last24h":
      return { from: new Date(now.getTime() - 24 * 3600_000), to: now };
    case "last30d":
      return { from: new Date(now.getTime() - 30 * 86400_000), to: now };
    case "last7d":
    default:
      return { from: new Date(now.getTime() - 7 * 86400_000), to: now };
  }
}

export function truncateToUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
