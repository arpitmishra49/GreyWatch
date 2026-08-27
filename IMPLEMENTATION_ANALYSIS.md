# Implementation Analysis — GreyWatch Pilot → Multi-Site Platform

Written before any code changes for the multi-site/email/auth expansion.
Covers the actual current implementation (verified against the running
code, not assumed from `context.md`), and what has to change.

## 1. Current architecture summary

- **Frontend + API**: Next.js 16 (App Router), TypeScript. Pages under
  `app/`, API routes under `app/api/**/route.ts`. No middleware-based route
  protection — each server page calls `getCurrentUser()` and redirects
  itself.
- **Background worker**: standalone `tsx` process (`worker/index.ts`), a
  30-second `setInterval` tick loop, talks to Prisma/SQLite directly (not
  through the Next.js API).
- **Database**: SQLite via Prisma `6.19.3` (deliberately pinned below
  latest — Prisma 7 breaks the schema-based `datasource url` this project
  relies on).
- **Grafana**: one instance, reached via `GRAFANA_BASE_URL`/
  `GRAFANA_API_TOKEN` env vars, read by `lib/grafana.ts` as a single global
  client. Screenshot capture via the `grafana-image-renderer` sidecar
  (Docker Compose).
- **Slack**: `@slack/web-api`, `lib/slack.ts`. Channel alerts + DMs, with a
  `resolveChannelId()` helper that explicitly opens a DM conversation via
  `conversations.open` before posting/uploading (works around a
  `files.uploadV2` limitation — see `context.md` §10.5).
- **Auth**: an httpOnly cookie (`gw_user_id`) holding a raw `User.id`. No
  password. Set/read via `lib/auth.ts`. No hashing library installed. No
  `middleware.ts`.

## 2. Current user flows

1. **Login**: username + Slack member ID (upserted as a `User`, cookie
   set). No password.
2. **Create task** (`/tasks/new`): pick the one seeded site → pick one or
   more panels from that site's single fixed dashboard (via
   `getPanels(dashboardUid)`) → per-panel operator/threshold → shared
   poll/cooldown/duration presets → optional "DM me on breach" → submit.
3. **View tasks** (`/tasks`): every task across the (currently single) site,
   each with its metrics nested underneath, auto-refreshing every 15s.
4. **Stop task**: sets `status = "stopped"`.
5. **Background**: worker polls due tasks every 30s, evaluates each metric
   independently, alerts Slack (channel + optional creator DM) on breach
   past cooldown, DMs the creator (not the channel) on a Grafana/API
   failure.

## 3. Current database entities (exact, from `prisma/schema.prisma`)

```
User          { id, username(unique), slackUserId, createdAt }
Site          { id, name(unique), dashboardUid }
MonitorTask   { id, siteId, pollIntervalMin, cooldownMin, durationMin,
                status, createdById, notifyCreator, startedAt, expiresAt,
                nextCheckAt }
TaskMetric    { id, taskId, panelId, panelTitle, operator, threshold,
                lastStatus, lastAlertAt, threadTs, creatorThreadTs }
TaskEvent     { id, metricId, checkedAt, success, errorMessage,
                capturedValue, breached, alerted }
```

Relations: `Site 1—N MonitorTask`, `User 1—N MonitorTask`,
`MonitorTask 1—N TaskMetric`, `TaskMetric 1—N TaskEvent`.

**This matches `context.md` exactly** — no drift between the documented
schema and the actual one. The only doc drift found: `context.md` §13
(visual design tokens) predates a later cream/terracotta/pill visual
redesign of the UI; cosmetic only, doesn't affect this analysis.

## 4. Existing integrations (verified working, must not break)

- **Grafana**: panel discovery (`/api/dashboards/uid/{uid}`), live value
  query (`/api/ds/query`, re-issuing each panel's own stored query — works
  against any datasource type without per-datasource logic), screenshot
  (`/render/d-solo/...`). Sandbox: Grafana 11.4.0 + `grafana-image-renderer`
  in Docker Compose, `TestData` datasource, one provisioned dashboard
  (`site-a`, 3 panels).
- **Slack**: `chat.postMessage` + `files.uploadV2` for channel alerts and
  threading; `conversations.open` for DM resolution. Required bot scopes:
  `chat:write`, `files:write`, `files:read`, `channels:read`, `im:write`.

## 5. Existing working features (confirmed by live testing earlier in this
project, not just code review)

- Independent per-metric breach detection, cooldown, and Slack threading.
- Per-metric error isolation (one bad panel doesn't block others in the
  same task tick).
- Poll/API failure → DM to the creator, never the shared channel.
- DM-failure isolation (a broken DM never corrupts a successful channel
  alert's saved thread state — this was a real bug found and fixed).
- Full UI flow (login → multi-metric task → list → stop) driven and
  screenshotted with a headless browser in both light and dark themes.

## 6. Existing technical debt / limitations (pre-existing, not introduced
by this analysis)

- No password auth; a self-reported Slack ID is trusted.
- No route middleware — protection is manual per page.
- Single Grafana instance, single site, 1:1 site→dashboard mapping (the
  new multi-site/multi-dashboard requirement breaks this assumption
  directly — see §8).
- SQLite on one machine; no deployment target yet.
- No email capability at all today.
- `GrafanaFetch`/`slackEnv` are module-level singletons reading env vars
  directly — not parameterized per site, which the new multi-instance
  requirement requires changing.

## 7. Files/components likely to be modified or added

| Area | Existing files touched | New files |
|---|---|---|
| Auth | `lib/auth.ts`, `app/login/page.tsx`, `app/api/auth/login/route.ts`, `prisma/schema.prisma` | `middleware.ts`, `lib/passwords.ts` |
| Site model | `prisma/schema.prisma`, `prisma/seed.ts` | — |
| Grafana | `lib/grafana.ts`, `app/api/sites/[siteId]/panels/route.ts` | `app/api/sites/[slug]/dashboards/route.ts` |
| Status providers | — | `lib/status/redZone.ts`, `lib/status/f90.ts` |
| Home/site directory | `app/page.tsx` | `app/(home)/page.tsx` or similar, site card components |
| Site details | — | `app/sites/[slug]/page.tsx` |
| Slack tasks | `app/tasks/**` (moved/adapted) | `app/sites/[slug]/slack-tasks/**` |
| Multi-recipient | `worker/index.ts`, `lib/slack.ts` | recipient UI components |
| Email | `worker/index.ts` | `lib/email.ts`, `app/sites/[slug]/email-tasks/**`, email API routes |
| Docs | `context.md` | this file, `IMPLEMENTATION_PLAN.md` |

## 8. Potential implementation risks

1. **Dropping `Site.dashboardUid`** breaks the existing 1:1 site→dashboard
   assumption baked into `getPanels()` and the new-task form. This is a
   deliberate, necessary change (dashboard selection must move to
   task-creation time once a site can host many dashboards) but touches
   every Grafana call site.
2. **Dropping `User.slackUserId`** is a breaking schema change requiring a
   data reset or migration, same as the earlier multi-metric migration —
   will get explicit confirmation before running it, per the established
   pattern in this project.
3. **N+1 queries on the home page** — 31 sites each needing active-task
   counts and breach counts is a real performance trap if done naively;
   must use grouped/aggregate Prisma queries.
4. **Per-recipient DM threading** adds real complexity (a join table keyed
   on metric × recipient) — needs its own isolated failure handling,
   mirroring the per-metric isolation already proven in the worker.
5. **Email scheduling correctness** — must reuse the same DB-driven
   `nextCheckAt`-style pattern (`nextSendAt`) rather than in-memory timers,
   for the same crash/restart-safety reason the Slack worker already uses
   it.
6. **Scope creep** — this is a large spec; the biggest risk is trying to
   do too much in one pass instead of checkpointing per phase.

## 9. Backward compatibility concerns

- Existing `MonitorTask`/`TaskMetric`/`TaskEvent` rows and their poll
  history are pilot/sandbox data (confirmed earlier in this project) —
  acceptable to reset with explicit consent, not acceptable to silently
  discard.
- The existing single seeded site ("Site A") is replaced by the 31-site
  seed; its sandbox dashboard/provisioning stays as the shared Grafana
  instance every site points to until real per-site URLs are provided.
- Existing Slack scopes and Grafana sandbox setup are reused as-is — no
  changes needed to `docker-compose.yml` or `provisioning/`.
