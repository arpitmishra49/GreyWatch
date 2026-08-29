import { z } from "zod";

// Split into independent groups (rather than one flat schema), each
// validated lazily on first access via a getter — so e.g. importing
// lib/grafana.ts only ever touches the Grafana vars, and
// scripts/test-grafana.ts can run and fail loudly on missing Grafana vars
// without also requiring Slack vars to be set. This matters during the
// sandbox build, where Grafana and Slack get wired up in separate steps.
const grafanaSchema = z.object({
  GRAFANA_BASE_URL: z.string().url(),
  GRAFANA_API_TOKEN: z.string().min(1, "GRAFANA_API_TOKEN is required"),
});

const slackSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required"),
  L3_CHANNEL_ID: z.string().min(1, "L3_CHANNEL_ID is required"),
});

const appSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
});

// The shared "CAN Engineer" account's credentials — never hardcoded, and
// never in frontend code. Read once by prisma/seed.ts to create/update the
// account; the app itself only ever compares against the stored hash.
const authSchema = z.object({
  CAN_ENGINEER_USERNAME: z.string().min(1, "CAN_ENGINEER_USERNAME is required"),
  CAN_ENGINEER_PASSWORD: z.string().min(8, "CAN_ENGINEER_PASSWORD must be at least 8 characters"),
});

function load<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid/missing ${label} environment variables:\n${issues}\n\nCopy .env.example to .env and fill in real values (see SETUP.md).`,
    );
  }
  return parsed.data;
}

function lazy<T>(fn: () => T): () => T {
  let cached: T | undefined;
  return () => {
    if (cached === undefined) cached = fn();
    return cached;
  };
}

const loadGrafanaEnv = lazy(() => load(grafanaSchema, "Grafana"));
const loadSlackEnv = lazy(() => load(slackSchema, "Slack"));
const loadAppEnv = lazy(() => load(appSchema, "app"));
const loadAuthEnv = lazy(() => load(authSchema, "auth"));

// Property access (not a plain object) so each group's validation only runs
// the moment a caller actually reads one of its fields.
export const grafanaEnv: z.infer<typeof grafanaSchema> = new Proxy({} as never, {
  get: (_target, prop) => loadGrafanaEnv()[prop as keyof z.infer<typeof grafanaSchema>],
});

export const slackEnv: z.infer<typeof slackSchema> = new Proxy({} as never, {
  get: (_target, prop) => loadSlackEnv()[prop as keyof z.infer<typeof slackSchema>],
});

export const appEnv: z.infer<typeof appSchema> = new Proxy({} as never, {
  get: (_target, prop) => loadAppEnv()[prop as keyof z.infer<typeof appSchema>],
});

export const authEnv: z.infer<typeof authSchema> = new Proxy({} as never, {
  get: (_target, prop) => loadAuthEnv()[prop as keyof z.infer<typeof authSchema>],
});

// Combined export for call sites (the Next.js app, the worker) that want
// every var validated up front, at startup, in one shot.
export function assertAllEnv(): void {
  loadGrafanaEnv();
  loadSlackEnv();
  loadAppEnv();
  loadAuthEnv();
}
