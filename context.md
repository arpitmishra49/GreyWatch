# Context: GreyWatch — Grafana → Slack Threshold Monitoring

**Status as of 2026-08-26: built and verified end-to-end on sandbox infrastructure
(local Grafana + a disposable Slack workspace). Not yet pointed at real
GreyOrange Grafana/Slack.**

## How to use this document

This is a complete as-built spec of a working system, written for another LLM
(or engineer) with zero prior context. It covers: the problem being solved,
the full tech stack and why each piece was chosen, the exact architecture and
data model, every external-API integration detail including the non-obvious
gotchas that cost real debugging time, the visual design system, and a
frank log of what was tried, what broke, and how it was fixed. It's meant to
support two things: (a) a critical review of whether this was built the
right way, and (b) reuse as a starting point for a similarly-shaped project
(a background poller bridging a metrics source to a chat tool) with
different technology or design choices.

The original pre-build planning doc (written before any code existed) is
preserved at `context-original.md` in this repo for comparison — several
things changed between that plan and what actually got built, and those
changes are called out explicitly below rather than silently absorbed.

---

## 1. The problem

An internal tool for a warehouse-operations support team (GreyOrange TAC/L3):
metrics live on Grafana dashboards (rack-to-rack pick time, orderline
throughput, per-unit order-wait-time, etc.), and today someone has to be
looking at the dashboard when a metric drifts out of range. That doesn't
scale and issues get caught late.

**What it needed to do:**
1. Let any teammate pick a site (= one Grafana dashboard), one or more
   panels on it, and a threshold per panel — via dropdowns/checkboxes, never
   free-typed queries.
2. Poll those panels in the background.
3. Post to Slack — with a screenshot — **only** when a threshold is
   breached. No routine/heartbeat screenshots.
4. Thread repeat breaches under the first message instead of spamming the
   channel; respect a cooldown before re-alerting.
5. Auto-expire after a set duration; allow manual stop.
6. If the tool itself breaks (can't reach Grafana), tell the person who
   started the watch — not the shared L3 channel. A broken tool and a bad
   metric are different problems with different owners.

## 2. Current status

- Fully built and manually verified against **sandbox infrastructure**: a
  local Grafana instance in Docker (with `grafana-image-renderer` for
  screenshots) generating realistic fake data, and a throwaway Slack
  workspace/app.
- Every integration point has been exercised with real network calls during
  development — not just code-reviewed. See §9 for the specific verification
  runs and what they proved.
- Not yet connected to the real GreyOrange Grafana/Slack. The intent (see
  §4) is that this is purely a `.env` change, not a code change.
- One real feature gap known and explicitly deferred: authentication is a
  username + Slack-ID cookie with no password (see §8).

## 3. Tech stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Frontend + API | Next.js, App Router, TypeScript | 16.3.2 | One project serves the UI and the CRUD API, sharing types between them. |
| Background worker | Standalone Node.js + TypeScript process (`tsx`) | — | Must run independently of the web app's request/response lifecycle — see §5. |
| Database | SQLite via Prisma | Prisma `6.19.3` (pinned — see §6.1) | Zero infra to stand up for a pilot; typed queries shared by the app and the worker for free. |
| Slack SDK | `@slack/web-api` | `^8.0.0` | Official SDK. |
| Validation | `zod` | `^4.4.3` | Request body validation, and env var validation (see §5.3). |
| Env loading | `dotenv` | `^17.4.2` | Used by the standalone worker process (Next.js loads `.env` itself). |
| Dev/test runner | `tsx` | `^4.23.12` | Runs TypeScript directly for the worker and one-off scripts, no build step. |
| Sandbox infra | Docker Compose — `grafana/grafana-oss:11.4.0` + `grafana/grafana-image-renderer:latest` | — | Reproducible locally, disposable. |

## 4. Architecture

Four pieces, one shared database as the only handoff point between the two
processes that matter:

```
Browser --(loads UI / calls API)--> Next.js App --(creates/reads tasks)--> SQLite DB
                                          |                                    ^
                                          | (panel discovery, live)            | (polls due tasks)
                                          v                                    v
                                       Grafana <--(query value + screenshot)-- Worker process
                                          ^                                    |
                                          |                                    v
                                     (renderer sidecar)                     Slack
                                                                   (postMessage / uploadV2)
```

**Why a separate worker process, not part of the Next.js app:** Next.js API
routes only run while answering a request — in a real deployment they can be
short-lived/serverless. A metric watch needs to keep checking for hours, so
that logic lives in its own always-running process.

**Why state lives in the database, not in memory:** each task has a
`nextCheckAt` timestamp. The worker's entire job, every 30 seconds, is: ask
the database which tasks are due, process exactly those, write back
`nextCheckAt = now + pollIntervalMin`. If the worker crashes, redeploys, or
the machine it's on restarts, it doesn't need to "remember" anything — it
just asks the database what's due again, and the database already reflects
reality. The alternative considered and rejected was one in-memory
`setInterval`/timer per active task, which loses every active watch on any
restart, including a dev-mode hot reload.

The worker talks **directly to Prisma/SQLite**, not through the Next.js
API — this keeps the polling loop's correctness independent of whether the
Next.js process happens to be up.

## 5. Data model

Four tables. `Site` is a 1:1 mapping to a Grafana dashboard. `MonitorTask`
represents one watch a teammate started — its shared settings (poll
interval, cooldown, duration, whether to also DM the creator). Each task can
watch **multiple panels at once**, each with its own condition — that's
`TaskMetric`. Every single poll of every metric, successful or not, writes
a `TaskEvent` — that append-only log is what makes the system debuggable
after the fact and is the ground truth for "did it alert, when, and why."

```prisma
model User {
  id          String        @id @default(cuid())
  username    String        @unique
  slackUserId String        // required for DM paths — see §5.1
  createdAt   DateTime      @default(now())
  tasks       MonitorTask[]
}

model Site {
  id           String        @id @default(cuid())
  name         String        @unique          // "Site A"
  dashboardUid String                         // Grafana dashboard UID
  tasks        MonitorTask[]
}

model MonitorTask {
  id              String       @id @default(cuid())
  siteId          String
  pollIntervalMin Int          // preset minutes — shared by every metric on this task
  cooldownMin     Int          // preset minutes — shared by every metric on this task
  durationMin     Int          // preset minutes
  status          String       @default("active") // active | stopped | expired
  createdById     String
  notifyCreator   Boolean      @default(false)     // also DM the creator on breach, in addition to L3
  startedAt       DateTime     @default(now())
  expiresAt       DateTime
  nextCheckAt     DateTime     // worker reads this to know what's due

  site      Site         @relation(fields: [siteId], references: [id])
  createdBy User         @relation(fields: [createdById], references: [id])
  metrics   TaskMetric[]

  @@index([status, nextCheckAt])
}

// One watched panel within a task. A task can watch several panels on the
// same site at once (e.g. Rack-to-Rack Time AND Orderline Throughput) —
// each gets its own condition and is polled/evaluated/alerted independently,
// even though they share the parent task's poll interval and cooldown.
model TaskMetric {
  id              String    @id @default(cuid())
  taskId          String
  panelId         Int       // Grafana panel ID
  panelTitle      String    // cached at creation time, for display
  operator        String    // "gt" | "lt" | "gte" | "lte" | "eq"
  threshold       Float
  lastStatus      String?   // "ok" | "breached" | "error"
  lastAlertAt     DateTime? // cooldown gate, per metric
  threadTs        String?   // L3 channel Slack thread_ts, per metric
  creatorThreadTs String?   // creator DM Slack thread_ts, per metric

  task   MonitorTask @relation(fields: [taskId], references: [id])
  events TaskEvent[]

  @@index([taskId])
}

model TaskEvent {
  id            String   @id @default(cuid())
  metricId      String
  checkedAt     DateTime @default(now())
  success       Boolean  // false = Grafana call failed
  errorMessage  String?
  capturedValue Float?
  breached      Boolean?
  alerted       Boolean  @default(false) // true if this check resulted in a Slack post

  metric TaskMetric @relation(fields: [metricId], references: [id])

  @@index([metricId, checkedAt])
}
```

### 5.1 A schema gap the original plan missed

The pre-build plan's `User` model had no field for a Slack member ID, even
though DMing the creator (on breach, and on tool failure) is a stated
requirement. `slackUserId` was added mid-build, required, collected at
login. Worth flagging in any review: **trace every feature requirement all
the way down to the data it needs to store** — this one was easy to miss
because the login flow itself didn't obviously need it.

### 5.2 Multi-metric was a mid-build addition, not the original design

The original plan had one panel/threshold per task (`panelId`,
`panelTitle`, `operator`, `threshold` directly on `MonitorTask`). Multi-metric
support was requested after the user saw a real Grafana dashboard with many
independent KPIs on one screen and wanted to watch several at once under one
task. The schema was restructured to move those fields into the child
`TaskMetric` table. This was a genuine breaking migration — SQLite can't
auto-populate a new required `metricId` foreign key on existing `TaskEvent`
rows — see §10 for how that was handled.

## 6. Grafana integration

Three endpoints, each doing exactly one job:

| Purpose | Endpoint | Notes |
|---|---|---|
| Panel discovery (populates the picker) | `GET /api/dashboards/uid/{uid}` | Returns `dashboard.panels[]`; used live every time the new-task form loads a site, never cached. |
| Live metric value | `POST /api/ds/query` | **Never hardcoded per datasource.** The app reads the panel's own existing target/query straight out of the dashboard JSON (whatever it is — a TestData scenario for the sandbox, a real InfluxDB query for production) and re-issues it with a fresh time range. This is what lets the same code work against any panel type without per-datasource logic — the worker doesn't know or care what's behind a panel. |
| Screenshot on breach | `GET /render/d-solo/{dashboardUid}?panelId={id}&width=1000&height=500&from=now-1h&to=now` | Requires the `grafana-image-renderer` sidecar (see §8). |

**The metric value is never read from the screenshot (no OCR, no guessing
from the image).** The threshold check always uses the number from
`/api/ds/query`. The screenshot is purely for a human glancing at Slack.

The Grafana API token used is a **Viewer-role service account token** —
this tool only ever reads, so its credential can't write.

## 7. Slack integration

`@slack/web-api`. Two outbound call shapes:

- **`chat.postMessage`** — first breach for a metric creates a new
  top-level message (no `thread_ts`); every later breach for that same
  metric posts with `thread_ts` set to the stored one, so a persistent issue
  reads as one conversation instead of flooding the channel.
- **`files.uploadV2`** — attaches the panel screenshot to that same
  message/thread, with a text comment distinguishing first alert ("🚨
  Threshold breached") from a repeat ("🚨 Still breached — Xm since last
  alert").

Failure notifications (`notifyCreatorOfFailure`) use `chat.postMessage`
alone, DMing the task creator directly — no screenshot, since there's no
successful metric read to show.

**Bot scopes required**, discovered incrementally (see §10 for the exact
bugs each of these fixed):

| Scope | Why |
|---|---|
| `chat:write` | Post messages and thread replies. |
| `files:write` | Upload screenshots. |
| `files:read` | **Easy to miss.** `files.uploadV2` reads the file back after uploading to confirm it landed — silently requires this even though the older `files.upload` method didn't. |
| `channels:read` (or `groups:read` for a private channel) | Needed to post into the L3 channel. |
| `im:write` | **Also easy to miss, and more subtle.** Required to resolve a Slack user ID into a real DM conversation via `conversations.open`. `chat.postMessage` alone will silently auto-open a DM given a bare user ID as `channel` — but `files.uploadV2`'s `channel_id` will not do that same auto-open, and fails with `invalid_arguments` on `/channel_id`. The fix (`lib/slack.ts`'s `resolveChannelId`) calls `conversations.open` explicitly for any target that looks like a user ID (`U`/`W` prefix) before either call, rather than relying on `chat.postMessage`'s implicit behavior. Channel IDs (`C`/`G` prefix) pass through unchanged. |

The bot must also be `/invite`d into the target channel before it can post
there, even with `chat:write`.

## 8. Sandbox infrastructure (Docker Compose)

`docker-compose.yml` runs two services: `grafana` (11.4.0, pinned — see
§10) and `renderer` (`grafana-image-renderer:latest`), wired together via
`GF_RENDERING_SERVER_URL`. A provisioned `TestData` datasource and a
`site-a` dashboard (3 panels tuned to mirror real fulfillment metrics —
Rack-to-Rack Time, Orderline Throughput, Per-Unit OWT — with bounded
random-walk ranges chosen so a reasonable threshold trips every few minutes)
let the whole pipeline be proven without needing real production Grafana
access first.

Two non-obvious Docker-specific fixes are already baked into the compose
file (see §10.2–10.3 for the debugging story): a shared `AUTH_TOKEN` between
the two containers, and explicit `GF_SERVER_DOMAIN`/`GF_SERVER_ROOT_URL`
matching the internal Docker hostname.

**What changes for real GreyOrange Grafana:** `GRAFANA_BASE_URL` and
`GRAFANA_API_TOKEN` point at the real instance instead; the `Site` table
gets a real `dashboardUid`. No application code should need to change,
because of the "reuse the panel's own query" design in §6 — if it does,
that's a sign something here quietly assumed sandbox-specific behavior.

## 9. The worker tick loop

Runs every 30 seconds (`worker/index.ts`). Per due task:

```
tick():
  dueTasks = MonitorTask where status=active AND nextCheckAt <= now
             (include site, createdBy, metrics)

  for task in dueTasks:
    if task.expiresAt <= now: mark expired; continue

    for metric in task.metrics:            # <-- each metric isolated, see below
      try:
        value = queryMetricValue(site.dashboardUid, metric.panelId)
        breached = evaluateThreshold(value, metric.operator, metric.threshold)
        log TaskEvent{success:true, capturedValue, breached}

        if breached and (cooldown elapsed since metric.lastAlertAt):
          screenshot = captureScreenshot(site.dashboardUid, metric.panelId)
          metric.threadTs = postBreach(L3_CHANNEL_ID, metric.threadTs, screenshot, ...)
          if task.notifyCreator:
            try:
              metric.creatorThreadTs = postBreach(createdBy.slackUserId, metric.creatorThreadTs, screenshot, ...)
            catch: log only — must not undo the L3 alert that already succeeded (see §10.6)
          metric.lastAlertAt = now
        metric.lastStatus = breached ? "breached" : "ok"
      catch (err):
        log TaskEvent{success:false, errorMessage}
        metric.lastStatus = "error"
        try: notifyCreatorOfFailure(createdBy.slackUserId, ...)  # DM, never L3
        catch: log only, don't crash the tick

      save metric

    task.nextCheckAt = now + task.pollIntervalMin
    save task
```

**Each metric has its own try/catch.** One panel failing to query (bad
panel ID, Grafana down, whatever) must not stop the task's other metrics
from being checked in the same tick — verified directly (§9.1).

**Poll/API failures DM the creator, never L3.** An unreachable Grafana
means the tool broke, not that the metric is bad — that's the requesting
engineer's problem, not something L3 should be paged about.

### 9.1 What was actually verified (not just code-reviewed)

Real runs during development, against the live sandbox:

- A task with 3 metrics (2 real panels + 1 deliberately bogus panel ID):
  confirmed the 2 real metrics were evaluated and alerted independently
  while the bogus one failed in isolation, never blocking the others.
- Forced a guaranteed breach on 2 real metrics: confirmed each got its own
  independent Slack thread (`threadTs`) in the L3 channel.
- Backdated `lastAlertAt` past the cooldown and re-triggered: confirmed the
  repeat breach **reused the same thread** (`threadTs` unchanged) rather
  than posting a duplicate top-level message.
- Pointed `GRAFANA_BASE_URL` at an unreachable address with a task active:
  confirmed the failure was logged as its own `TaskEvent`, a DM went to the
  creator, and the L3 channel was never touched.
- Live DM test (after adding the `im:write` scope): confirmed a first-breach
  DM, a repeat-breach DM reusing the same `creatorThreadTs`, and a failure
  DM all post correctly.
- Full UI flow driven with a headless browser (login → multi-metric task
  creation, panels populated live from Grafana → tasks list → stop),
  screenshotted in both light and dark themes, zero console errors.

## 10. Bugs found and fixed during the build (read this before reviewing)

These are worth a reviewer's specific attention — each was a real,
non-obvious failure discovered by actually running the system, not by
reading the code:

1. **Prisma 7 breaks the "swap `.env`, not code" promise.** A plain
   `npm install prisma` pulls the latest major version, which removes `url`
   from the `datasource` block in the schema and requires a driver-adapter
   package for SQLite. Pinned to `6.19.3` instead, matching the original
   plan's simple schema-based config. Anyone reusing this project should
   re-check this pin against whatever Prisma version is current when they
   start.
2. **Grafana refuses a default renderer token in newer versions.** Fresh
   `grafana-oss:latest` failed to start with `renderer_token is not allowed
   for production settings`. Fixed with an explicit shared
   `GF_RENDERING_RENDERER_TOKEN` (Grafana side) / `AUTH_TOKEN` (renderer
   side) — note the **names don't match** despite configuring the same
   value; this is easy to get wrong once, let alone from a cold start.
3. **The render callback needs an explicit domain.** The renderer's callback
   to Grafana (`http://grafana:3000/...`) was silently rejected by Grafana's
   `validate_action_url` middleware because Grafana's default `root_url`
   domain didn't match the Docker-network hostname. Fixed with explicit
   `GF_SERVER_DOMAIN=grafana` / `GF_SERVER_ROOT_URL=http://grafana:3000/`.
4. **`files.uploadV2` silently needs `files:read`**, unlike the older
   `files.upload` — see §7.
5. **`files.uploadV2` needs `im:write` for DMs, but `chat.postMessage`
   doesn't** — the two Slack methods handle a bare user-ID `channel` target
   inconsistently. See §7's `im:write` row for the full mechanism; this was
   the single most confusing bug in the whole build, because the symptom
   (`invalid_arguments` on `/channel_id`) gave no hint that scopes, not
   argument shape, were the actual problem.
6. **A DM failure was silently corrupting a successful channel alert's
   saved state.** Once `notifyCreator` support existed, a missing `im:write`
   scope caused the creator-DM `postBreach` call to throw — but that
   exception was thrown from inside the *same* try block that had already
   posted successfully to the L3 channel, so the whole metric got logged as
   "error" and the L3 message's `threadTs` was never saved (meaning a repeat
   breach would have posted a duplicate instead of threading). Fixed by
   wrapping the creator-DM call in its own inner try/catch, isolated from
   the channel-alert code path.
7. **A newer bleeding-edge `grafana-image-renderer` build turned out to be
   flaky under load** (an occasional 30s+ timeout on `/render`, confirmed
   as a one-off by immediately retrying successfully 3/3 times). Not
   "fixed" per se — the worker's existing retry-on-next-poll behavior
   already absorbs this, and it's noted in `SETUP.md` as expected.
8. **A stray `package.json`/`package-lock.json` in the parent home
   directory** confused Turbopack's workspace-root detection into an
   unrelated warning. Fixed by pinning `turbopack.root` explicitly in
   `next.config.ts` — worth doing regardless of whether that stray file
   exists on a given machine.

## 11. Design decisions (the "why", not just the "what")

| Decision | Alternative considered | Why this one |
|---|---|---|
| State lives in the DB (`nextCheckAt`), not in-process timers | One `setInterval`/timer per active task | Timers vanish on any restart (crash, redeploy, hot reload); a DB column doesn't. |
| Standalone worker process, separate from the Next.js app | Cron-style job inside a Next.js API route | API routes don't stay alive between requests and can be short-lived/serverless in real deployments. |
| SQLite via Prisma | Postgres | Zero infra for a pilot; typed client shared for free between the app and the worker. |
| Metric values always from `/api/ds/query` | Reading the screenshot / OCR | The screenshot is for a human; the threshold decision needs a real number, not an image guess. |
| Re-issue each panel's own existing query, never hardcode per-datasource logic | A TestData-specific query builder | Makes the same code work against a real InfluxDB-backed panel with zero changes — the whole point of the sandbox/real split in §8. |
| Cooldown + Slack threading | Alert on every breached poll | Without it, a metric hovering at the threshold would spam on every single check. |
| Poll/API failures DM the creator, never L3 | Post failures to L3 too | A broken tool and a bad metric are different problems for different owners; L3 shouldn't be paged for the former. |
| Multi-metric: independent per-metric state (`lastStatus`, `lastAlertAt`, `threadTs`), shared task-level settings (poll interval, cooldown, duration) | Fully independent tasks per metric, or one shared alert state per task | Metrics on the same task legitimately breach at different times and need independent cooldowns/threads, but a teammate thinks of "watching this site" as one task, not N separate ones — see §5.2. |
| Poll interval / cooldown / duration are fixed presets, not free-text | Free-text minute fields | Prevents a 1-second poll interval that hammers Grafana, or a watch nobody remembers is running 6 months later. |
| Grafana service account is Viewer-role only | A broader role "to be safe" | The tool never writes to Grafana — its credential shouldn't be able to either. |
| Username + Slack-ID cookie, no password | Real SSO from day one | Enough to attribute tasks and route DMs during a small pilot; explicitly flagged (not silently shipped) as needing real auth before a wider rollout — see §12. |
| Env vars validated at startup, split into independent Grafana/Slack/app groups (lazy-loaded via a Proxy, see `lib/env.ts`) | One flat validated-at-import schema | Lets `scripts/test-grafana.ts` and `scripts/test-slack.ts` each be run and fail loudly on their own missing vars, without requiring the other integration to be configured yet — mattered a lot while building, since Grafana and Slack got wired up in separate steps. |

## 12. Known limitations (explicitly deferred, not overlooked)

- **Auth is not real auth.** No password; a Slack member ID is
  self-reported at login and trusted. Fine for a small pilot with a
  handful of known teammates, not fine at wider scale.
- **No task editing.** Stopping and recreating is the only way to change a
  running task's panels/thresholds/settings.
- **No multi-site fan-out in one task.** A task's metrics are all on one
  site (`MonitorTask.siteId` is singular); watching panels across multiple
  sites needs multiple tasks.
- **SQLite is a pilot choice.** Fine for one small team on one machine;
  would need Postgres (or similar) for concurrent multi-instance
  deployment.
- **The app and worker both currently run on a developer's laptop.** There
  is no always-on deployment yet — real use needs a real host.
- **Grafana render occasionally times out** under the sandbox's specific
  renderer build (§10.7) — the worker's retry-on-next-poll already covers
  this, but it's not literally zero-flake.

## 13. Visual design system

Product name: **GreyWatch**. Applied consistently across the app UI and a
separate manager-facing pitch document built from the same tokens.

- **Type**: IBM Plex Sans (UI chrome, labels, body — weights 400–700) + IBM
  Plex Mono (data values, timestamps, thresholds, status text) throughout
  the app. Loaded via Google Fonts (`@import` in `app/globals.css`).
- **Color** (tokens defined for both light and dark, `prefers-color-scheme`
  + `[data-theme]` override support):
  - `--paper` / `--surface` / `--ink` / `--slate` — warm off-white neutrals,
    not a generic gray, with light/dark pairs.
  - `--amber` — the single brand accent (primary buttons, brand mark, focus
    ring). Never reused for status semantics.
  - `--teal` — "healthy/active" status color, kept a separate hue from the
    accent.
  - `--danger` — "breached/error" status color, also a separate hue from
    the accent (the design principle followed: semantic color is distinct
    from the brand accent, not a reuse of it).
- **Layout**: a slim sticky top nav (brand mark + wordmark, nav links,
  username + logout) rather than a sidebar — the app only has 3
  destinations, which doesn't justify a sidebar the way a longer document
  would.
- **Components worth noting**: the multi-metric picker
  (`app/tasks/MetricPicker.tsx`) is a checklist where checking a panel
  reveals an inline condition+threshold row for just that panel; the tasks
  table nests each task's metrics as a compact sub-table underneath it
  (always expanded — a handful of metrics per task is the expected scale,
  and hiding them by default would bury the exact info the page exists to
  show); status is always a colored pill with a dot, never color alone.

## 14. File map

```
greywatch/
├── prisma/
│   ├── schema.prisma        # §5
│   ├── migrations/
│   └── seed.ts              # seeds the "Site A" row
├── app/
│   ├── api/
│   │   ├── auth/login, auth/logout
│   │   ├── sites, sites/[siteId]/panels   # panel discovery proxy, §6
│   │   └── tasks, tasks/[id]/stop, tasks/[id]/events
│   ├── login/page.tsx
│   ├── tasks/
│   │   ├── page.tsx           # nested per-task metric table, §13
│   │   ├── new/page.tsx       # multi-metric picker form
│   │   ├── MetricPicker.tsx
│   │   ├── StopButton.tsx, AutoRefresh.tsx
│   └── globals.css            # design tokens, §13
├── lib/
│   ├── grafana.ts             # getPanels, queryMetricValue, captureScreenshot, evaluateThreshold — §6
│   ├── slack.ts                # postBreach, notifyCreatorOfFailure, resolveChannelId — §7
│   ├── env.ts                  # lazy per-group env validation — §11
│   ├── auth.ts, prisma.ts, types.ts
├── worker/index.ts             # the tick loop, §9
├── scripts/test-grafana.ts, test-slack.ts   # standalone connectivity checks
├── provisioning/                # Grafana datasource + dashboard, §8
├── docker-compose.yml           # §8, §10.2–10.3
├── SETUP.md                     # step-by-step manual setup (Grafana SA, Slack app/scopes, .env)
└── context-original.md          # the pre-build plan, for comparison
```

## 15. Questions worth putting to a reviewing LLM

If handing this to another model for critique, these are the genuinely
open judgment calls worth a second opinion on, rather than settled facts:

1. Is per-metric independent cooldown/threading (§5.2, §11) the right
   granularity, or should a task's metrics share one alert state/thread?
2. Is SQLite + a standalone polling worker the right architecture past
   pilot scale, or does this need a real job queue (BullMQ, etc.) once
   there are many teams' worth of tasks?
3. Is DMing the creator (vs. L3) on tool failure the right call at scale,
   or does a broken integration eventually need its own dedicated
   ops-facing alert path?
4. Is the username+Slack-ID login an acceptable pilot shortcut, or should
   real auth be a blocker before *any* wider internal use, even informal?
