# Context: Grafana → Slack Monitoring Automation (Pilot Build)

## Where This Picks Up

This is the build context for the **personal sandbox pilot** — a self-contained version built
against a dummy Slack workspace and a self-hosted Grafana instance, so the tool can be built and
tested end-to-end before asking GreyOrange for real Grafana/Slack access. Once the pilot works,
the ask is to swap sandbox credentials for real org credentials — the code shouldn't need to change,
only the `.env` values.

Role/background: Software Support Engineer (TAC) intern at GreyOrange, strong MERN/PERN background.
This doc assumes that context and does not re-explain basic tooling.

## What We're Building (Recap)

A self-service internal tool where any teammate can:
1. Pick a site (site = one Grafana dashboard, 1:1 mapping).
2. Pick a panel/metric from a dropdown — **fetched live from Grafana**, never typed manually.
3. Set a threshold (operator + value).
4. Pick poll interval, cooldown, and duration from **preset dropdowns** (not free text).
5. Start the task.

The tool then polls the real metric value from Grafana in the background. **No routine
screenshots** — a screenshot + Slack alert is sent only when the threshold is breached. Repeated
breaches for the same task thread together in Slack. Re-alerting on a persistent breach respects
the cooldown. The task auto-expires after its duration; a manual stop is also available. Poll/API
failures notify the task's creator (not L3) since that means "the tool is broken," not "the
warehouse metric is bad."

This is unchanged from prior discussion — what follows is the concrete tech stack and build plan
for the sandbox pilot.

---

## Final Tech Stack (Pilot)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Next.js (App Router) + TypeScript** | Chosen over plain React/Vite for built-in routing and API routes. |
| Backend API | **Next.js Route Handlers** (`app/api/**/route.ts`) | Handles CRUD: tasks, panel discovery, login. Shares types with the frontend. |
| Background worker | **Standalone Node.js + TypeScript process**, separate from Next.js | See "Why a separate worker" below — this is the one piece that can't live inside Next.js API routes. |
| Database | **SQLite via Prisma** | Single file, shared schema/client between the Next.js app and the worker. Prisma gives typed queries on both sides "for free" since everything is TypeScript. |
| Grafana capture | **Grafana's `/render` endpoint**, backed by the `grafana-image-renderer` sidecar container | As of current Grafana versions, the renderer is a **separate Docker service**, not an in-Grafana plugin — see sandbox setup below. |
| Grafana metric values | **`/api/ds/query`** | Always reads the real number. Never OCR the screenshot. |
| Panel discovery | **`/api/dashboards/uid/{uid}`** | Returns the dashboard JSON model; used to populate the panel dropdown with real titles. |
| Sandbox metric data | **Grafana's built-in TestData datasource** | Generates random-walk/CSV time series with no external DB — used to fake "rack-to-rack time"-style panels without needing InfluxDB. |
| Slack integration | **`@slack/web-api`** (official SDK) | `chat.postMessage` (thread create/reply) + `files.uploadV2` (screenshots). |
| Identity (pilot only) | **Username-only cookie "login"** | No password. Just enough to simulate multiple teammates creating tasks. Not real auth — flagged for replacement before real rollout. |
| Deployment (pilot) | **Local machine**, `docker-compose` for Grafana + renderer | No public URL needed — the app only makes outbound calls to Grafana and Slack, it doesn't need to receive inbound webhooks for this feature set. |

### Why a separate background worker (this is a deliberate change from earlier discussion)

Next.js API routes are request/response handlers — they don't stay alive between requests, and in
a real deployment they may run as short-lived serverless functions. That makes them the wrong
place to own a poller that needs to keep checking Grafana every few minutes for hours at a time.

Earlier discussion proposed one in-memory timer per active task. That has the same problem in a
different shape: if the process restarts (crash, redeploy, or even Next.js's dev-mode hot reload),
every in-memory timer is gone and every active monitor silently stops.

**The fix carried into this build:** state lives in the database, not in memory.

- Every task row has a `nextCheckAt` timestamp.
- The worker runs a single loop (`setInterval`, e.g. every 30 seconds) that asks the database
  "which tasks are due?" and processes just those.
- After processing, it writes the new `nextCheckAt = now + pollInterval` back to the row.
- On restart, the worker doesn't need to "re-arm" anything — it just resumes asking the database
  what's due, which already reflects reality.

This is simpler than per-task timers and free to make crash-safe, so it's the recommended design
even though it wasn't the original plan.

---

## Data Model (Prisma schema, draft)

```prisma
// schema.prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        String   @id @default(cuid())
  username  String   @unique
  createdAt DateTime @default(now())
  tasks     MonitorTask[]
}

model Site {
  id            String   @id @default(cuid())
  name          String   @unique          // "Site A"
  dashboardUid  String                    // Grafana dashboard UID
}

model MonitorTask {
  id              String    @id @default(cuid())
  siteId          String
  panelId         Int                      // Grafana panel ID
  panelTitle      String                   // cached at creation time, for display
  operator        String                   // "gt" | "lt" | "gte" | "lte" | "eq"
  threshold       Float
  pollIntervalMin Int                      // preset minutes, e.g. 5
  cooldownMin     Int                      // preset minutes, e.g. 15
  durationMin     Int                      // preset minutes, e.g. 240 (4h)
  status          String    @default("active") // active | stopped | expired
  createdById     String
  createdBy       User      @relation(fields: [createdById], references: [id])
  notifyCreator   Boolean   @default(false) // also DM the creator on breach, in addition to L3
  threadTs        String?                  // Slack thread_ts once first breach posts it
  startedAt       DateTime  @default(now())
  expiresAt       DateTime
  nextCheckAt     DateTime                 // worker reads this to know what's due
  lastAlertAt     DateTime?                // used to enforce cooldown
  lastStatus      String?                  // "ok" | "breached" | "error" — last known state
  events          TaskEvent[]

  site            Site      @relation(fields: [siteId], references: [id])
}

model TaskEvent {
  id             String      @id @default(cuid())
  taskId         String
  task           MonitorTask @relation(fields: [taskId], references: [id])
  checkedAt      DateTime    @default(now())
  success        Boolean                    // false = Grafana call failed
  errorMessage   String?
  capturedValue  Float?
  breached       Boolean?
  alerted        Boolean     @default(false) // true if this check resulted in a Slack post
}
```

Kept intentionally simple for a pilot — no separate "panel cache" table; panel lists are fetched
live from Grafana each time the create-task form loads.

---

## Background Worker — Tick Logic

```
every 30s:
  dueTasks = SELECT * FROM MonitorTask WHERE status = 'active' AND nextCheckAt <= now()

  for task in dueTasks:
    if task.expiresAt <= now():
      task.status = 'expired'; save; continue

    try:
      value = grafana.queryMetricValue(task)         // /api/ds/query
      breached = evaluateThreshold(value, task.operator, task.threshold)

      logEvent(task, { success: true, capturedValue: value, breached })

      if breached:
        cooldownOk = !task.lastAlertAt || (now() - task.lastAlertAt) >= task.cooldownMin
        if cooldownOk:
          screenshot = grafana.captureScreenshot(task)   // /render
          slack.postBreach(task, value, screenshot)      // threads under task.threadTs
          task.lastAlertAt = now()
          task.lastStatus = 'breached'
      else:
        task.lastStatus = 'ok'

    catch (err):
      logEvent(task, { success: false, errorMessage: err.message })
      slack.notifyCreatorOfFailure(task, err)          // DM/personal notification, not L3

    task.nextCheckAt = now() + task.pollIntervalMin
    save(task)
```

Run this with `tsx watch worker/index.ts` in dev, or compiled + `node dist/worker/index.js` for
anything longer-running. A plain `setInterval` is enough at this scale — no need for `node-cron`,
BullMQ, or a job queue; there's nothing here that needs cron-style calendar scheduling (e.g. "every
Monday at 9am"), just "check again in N minutes," which a simple loop handles natively.

---

## API Endpoints (Next.js Route Handlers)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Body: `{ username }`. Upserts a `User`, sets an httpOnly cookie. No password. |
| `GET` | `/api/sites` | Lists configured sites (from the `Site` table — seeded, not user-editable in the pilot). |
| `GET` | `/api/sites/:siteId/panels` | Proxies Grafana's `/api/dashboards/uid/{uid}`, returns `[{ id, title }]` for the dropdown. |
| `POST` | `/api/tasks` | Creates a task. Body includes siteId, panelId, panelTitle, operator, threshold, pollIntervalMin, cooldownMin, durationMin, notifyCreator. Computes `expiresAt` and initial `nextCheckAt`. |
| `GET` | `/api/tasks` | Lists tasks (active + recent) for the dashboard/table view. |
| `POST` | `/api/tasks/:id/stop` | Manual stop — sets `status = 'stopped'`. |
| `GET` | `/api/tasks/:id/events` | Recent poll history for a task — useful for debugging during the pilot. |

The worker talks directly to the same Prisma/SQLite database — it does not call these HTTP
endpoints, to keep the polling loop independent of the Next.js process being up.

---

## Slack Integration Details

- **Scopes needed on the sandbox Slack app:** `chat:write`, `files:write`, `files:read`,
  `channels:read` (or `groups:read` for private channels). Note: `files:read` is easy to miss —
  the modern `files.uploadV2` SDK helper silently needs it even though the old `files.upload`
  method didn't.
- **Thread model:** first breach for a task creates a new message (`chat.postMessage`, no
  `thread_ts`) and stores the returned `ts` as `threadTs` on the task. Every subsequent breach for
  that same task posts with `thread_ts: task.threadTs`, so a recurring breach reads as one
  conversation.
- **Screenshot delivery:** `files.uploadV2({ channel_id, thread_ts, file: buffer, filename,
  initial_comment })`.
- **Cooldown re-alert wording:** distinguish the first alert ("🚨 Threshold breached") from a
  repeat ("🚨 Still breached — Xs since last alert") so the thread reads naturally.
- **Failure notifications:** DM the creator directly (`chat.postMessage` with the user's Slack
  member ID as the channel) rather than posting anywhere shared.

## Grafana Integration Details

- **Screenshot:** `GET {GRAFANA_URL}/render/d-solo/{dashboardUid}?panelId={id}&width=1000&height=500&from=now-1h&to=now`,
  `Authorization: Bearer {token}`. Requires the `grafana-image-renderer` sidecar to be running and
  configured via `GF_RENDERING_SERVER_URL` on the main Grafana container.
- **Metric value:** `POST {GRAFANA_URL}/api/ds/query` with a `queries[]` body referencing the
  panel's datasource UID and query. For the sandbox, this targets the TestData datasource
  (`scenarioId: "random_walk"` or `"csv_content"`), which returns a predictable frame shape —
  useful for getting the parsing logic right before pointing at the real InfluxDB-backed panels.
- **Panel discovery:** `GET {GRAFANA_URL}/api/dashboards/uid/{uid}` — `dashboard.panels[]`, each
  with `id` and `title`. This is what powers the panel dropdown.

---

## Sandbox Setup

### 1. Grafana + renderer (docker-compose)

```yaml
# docker-compose.yml
services:
  grafana:
    image: grafana/grafana-oss:latest
    ports: ["3001:3000"]
    environment:
      - GF_RENDERING_SERVER_URL=http://renderer:8081/render
      - GF_RENDERING_CALLBACK_URL=http://grafana:3000/
      - GF_LOG_FILTERS=rendering:debug
    volumes:
      - ./provisioning:/etc/grafana/provisioning
    depends_on: [renderer]

  renderer:
    image: grafana/grafana-image-renderer:latest
    ports: ["8081:8081"]
```

(Note: port `3001` on the host avoids clashing with the Next.js dev server on `3000`.)

### 2. Provision a TestData dashboard that mirrors the real site panels

`provisioning/datasources/testdata.yaml`:
```yaml
apiVersion: 1
datasources:
  - name: TestData
    type: testdata
    uid: testdata-ds
    isDefault: true
```

`provisioning/dashboards/*.json` — build a dashboard with panels named to match the real ones
(e.g. "Rack to Rack Time - Pick (Seconds)" as a gauge, `scenarioId: random_walk` tuned to
oscillate around the 15–25 range so it periodically crosses the 20s threshold). This is what
makes the pilot behave like the real dashboards instead of just proving the plumbing works.

### 3. Slack sandbox

- Create a free Slack workspace for this (e.g. via slack.com, "Create a Workspace").
- Create a Slack App (api.slack.com/apps) — **From scratch**.
- Add the scopes listed above under OAuth & Permissions → Install to Workspace → copy the
  `xoxb-...` Bot Token.
- Create a couple of test channels (`#l3-alerts`, `#ops-monitoring`) and `/invite` the bot into
  each — Slack requires this before the bot can post.
- Get the channel IDs (right-click channel → View channel details) for the `.env`.

### 4. Environment variables

```
# Grafana (sandbox)
GRAFANA_BASE_URL=http://localhost:3001
GRAFANA_API_TOKEN=<sandbox service account token, Viewer role>

# Slack (sandbox)
SLACK_BOT_TOKEN=xoxb-...
L3_CHANNEL_ID=C0XXXXXXX

# App
DATABASE_URL=file:./dev.db
PORT=3000
```

---

## Preset Values (defaults for the dropdowns — adjust after real usage)

These were left open in earlier discussion; shipping with sensible defaults rather than leaving
them unresolved, since they're trivial to change later:

- **Poll interval:** 1 min / 5 min / 15 min / 30 min
- **Cooldown:** 5 min / 15 min / 30 min / 1 hr
- **Duration:** 1 hr / 2 hr / 4 hr / 8 hr / 1 day

## Folder Structure (proposed)

```
grafana-slack-monitor/
├── prisma/
│   └── schema.prisma
├── app/                        # Next.js App Router
│   ├── api/
│   │   ├── auth/login/route.ts
│   │   ├── sites/route.ts
│   │   ├── sites/[siteId]/panels/route.ts
│   │   └── tasks/route.ts, tasks/[id]/stop/route.ts, tasks/[id]/events/route.ts
│   ├── tasks/page.tsx          # active tasks list
│   ├── tasks/new/page.tsx      # new task form
│   └── login/page.tsx
├── lib/
│   ├── grafana.ts              # captureScreenshot, queryMetricValue, evaluateThreshold, getPanels
│   ├── slack.ts                # postBreach, notifyCreatorOfFailure, ensureThread
│   ├── prisma.ts               # shared Prisma client singleton
│   └── types.ts                # shared types (task form payloads, etc.)
├── worker/
│   └── index.ts                # the tick loop described above
├── provisioning/
│   ├── datasources/testdata.yaml
│   └── dashboards/site-a.json
├── docker-compose.yml
├── .env.example
└── package.json                # scripts: "dev" (Next.js), "worker" (tsx watch worker/index.ts)
```

## Build Order (suggested)

1. `docker-compose up` — get Grafana + renderer running, confirm `/render` returns a PNG manually via curl.
2. Provision the TestData dashboard with panels matching the real site layout; confirm thresholds trip periodically.
3. Slack sandbox app + bot; confirm `chat.postMessage` and `files.uploadV2` work via a throwaway script.
4. Prisma schema + migration; confirm the DB is queryable.
5. `lib/grafana.ts` and `lib/slack.ts` — the two integration modules, tested standalone before wiring into the app.
6. Worker tick loop, pointed at one manually-inserted task row — confirm the full breach → screenshot → Slack thread flow works end to end.
7. Next.js API routes (CRUD).
8. Next.js UI (login, new task form, active tasks list) — matches the mockups already reviewed.
9. Wire the "notify creator on failure" path — deliberately break Grafana access mid-run to confirm it fires correctly.

## Open Items Carried Forward

- Whether a new task on the same site/panel/threshold should reuse an old Slack thread or always
  start fresh — still open, doesn't block starting the build.
- Real preset values may change once used for real — the defaults above are a starting point.
- Real Grafana/Slack access request (see the separate proposal documents) happens once this pilot
  proves the flow works end to end on sandbox data.
