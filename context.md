# Context: GreyWatch — Multi-Site Monitoring Platform

**Status as of 2026-08-28: built and verified end-to-end on sandbox
infrastructure** (local Grafana + a disposable Slack workspace + Ethereal
fake-SMTP email). 31 real GreyOrange site names seeded, all pointed at the
sandbox Grafana instance for now. Not yet pointed at real per-site Grafana
URLs, a real Slack workspace, or a real email provider — that's a
credentials/config change, not a rebuild.

## How to use this document

This supersedes `context-pilot-v1.md` (the single-site pilot this was built
from) and `context-original.md` (the original pre-build plan). All three
are kept for history — comparing them shows exactly what changed and why at
each stage. This document is written for another LLM or engineer with zero
prior context: the problem, the full architecture, every schema table and
why it's shaped that way, every integration's non-obvious behavior, and a
frank log of what broke during the build and how it was fixed.

---

## 1. What changed from the single-site pilot

The pilot (one site, username+Slack-ID login, single-panel-per-task Slack
alerts) became a real internal platform:

- **Real auth**: a shared `CAC Engineer` username+password login, with the
  `User` model built to support individual users/roles later without
  another migration.
- **31 real sites**, each an independent Grafana "instance" (today they all
  point at the same sandbox Grafana, but the model supports real per-site
  URLs/tokens).
- **Dashboard discovery moved to task-creation time** — a site is a Grafana
  instance, not one fixed dashboard, so picking a dashboard is now step one
  of creating any task (Slack or email).
- **Multiple Slack recipients per task**, each with independent DM
  threading, replacing the old single "DM the creator" concept (which broke
  entirely once login stopped being personal).
- **A whole new email subsystem** — scheduled reports (not alerts) per
  site, reusing the same dashboard/panel-discovery UI and the same
  DB-driven, restart-safe scheduling pattern as Slack monitoring.
- **A real home page** — a searchable, filterable, paginated site
  directory, with two new "Red Zone"/"F90" status concepts stubbed behind a
  clean provider abstraction pending real APIs.

The original single-site pilot's core mechanics — per-metric independent
evaluation, cooldown, Slack threading, screenshot-on-breach, the DB-driven
worker tick loop — are **unchanged in spirit**, just extended from
"one panel per task" to "many panels, many recipients, many sites."

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend + API | Next.js 16, App Router, TypeScript | Unchanged from the pilot. |
| Background worker | Standalone Node.js/TypeScript process (`tsx`) | Now runs two independent tick loops — Slack and email. |
| Database | SQLite via Prisma `6.19.3` (pinned — Prisma 7 breaks the schema-based config this relies on) | 11 tables now (see §4). |
| Auth | Node's built-in `crypto.scrypt` for password hashing | No new dependency. |
| Slack SDK | `@slack/web-api` | Unchanged. |
| Email | `nodemailer` | New — `EtherealEmailProvider` for the sandbox, swappable behind an `EmailProvider` interface. |
| Sandbox infra | Docker Compose — `grafana/grafana-oss:11.4.0` + `grafana-image-renderer` | Unchanged; dashboard content extended (§10). |

## 3. Architecture

```
Browser --> Next.js App --> SQLite DB <-- Worker process (two tick loops)
                |                              |         |
                | (site-scoped dashboard/panel |         |
                |  discovery, per site)        |         |
                v                              v         v
             Grafana (per-site config)      Grafana    Slack + Ethereal/Email
```

Same fundamental shape as the pilot (§4 of `context-pilot-v1.md`): the
database is still the only handoff point between the always-on worker and
the request/response Next.js app, for the same crash/restart-safety reason.
What's new is that **Grafana config is now resolved per-site** rather than
read from one global env client (`lib/grafana.ts`'s `resolveSiteGrafanaConfig`),
and there are now **two independent due-queries** in the worker — one for
`MonitorTask.nextCheckAt` (Slack), one for `EmailTask.nextSendAt` (email) —
each with its own task-level try/catch isolation, so a failure in one never
affects the other.

## 4. Data model (11 tables)

```prisma
model User {
  id           String   @id @default(cuid())
  username     String   @unique
  passwordHash String
  role         String   @default("engineer") // unused today, future-ready
  createdAt    DateTime @default(now())
  tasks        MonitorTask[]
  emailTasks   EmailTask[]
}

model Site {
  id              String   @id @default(cuid())
  name            String   @unique // display name, preserved verbatim — e.g. "GXO-A&F"
  slug            String   @unique // stable id, e.g. "gxo-a-and-f" — never affects the display name
  grafanaBaseUrl  String
  grafanaApiToken String?  // per-site override; null falls back to the shared env token
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  tasks           MonitorTask[]
  emailTasks      EmailTask[]
}

model MonitorTask {
  id              String   @id @default(cuid())
  siteId          String
  dashboardUid    String   // chosen at creation time — see §1
  pollIntervalMin Int
  cooldownMin     Int
  durationMin     Int
  status          String   @default("active") // active | stopped | expired
  createdById     String
  startedAt       DateTime @default(now())
  expiresAt       DateTime
  nextCheckAt     DateTime
  site       Site @relation(...)
  createdBy  User @relation(...)
  metrics    TaskMetric[]
  recipients NotificationRecipient[]
}

model NotificationRecipient {
  id          String   @id @default(cuid())
  taskId      String
  slackUserId String
  createdAt   DateTime @default(now())
  task    MonitorTask @relation(...)
  threads RecipientAlertThread[]
}

model TaskMetric {
  id          String    @id @default(cuid())
  taskId      String
  panelId     Int
  panelTitle  String
  operator    String
  threshold   Float
  lastStatus  String?
  lastAlertAt DateTime? // shared cooldown clock across L3 + every recipient
  threadTs    String?   // L3 channel thread, per metric
  task             MonitorTask @relation(...)
  events           TaskEvent[]
  recipientThreads RecipientAlertThread[]
}

// Per-metric, per-recipient DM thread — cooldown is one shared clock
// (TaskMetric.lastAlertAt), but each person has their own DM conversation.
model RecipientAlertThread {
  id          String @id @default(cuid())
  metricId    String
  recipientId String
  threadTs    String
  metric    TaskMetric             @relation(...)
  recipient NotificationRecipient  @relation(...)
  @@unique([metricId, recipientId])
}

model TaskEvent {
  id            String   @id @default(cuid())
  metricId      String
  checkedAt     DateTime @default(now())
  success       Boolean
  errorMessage  String?
  capturedValue Float?
  breached      Boolean?
  alerted       Boolean  @default(false)
  metric TaskMetric @relation(...)
}

// --- Email (new) ---

model EmailTask {
  id           String    @id @default(cuid())
  siteId       String
  dashboardUid String
  intervalMin  Int       // coarser presets than Slack polling — see §8
  durationMin  Int
  status       String    @default("active")
  createdById  String
  startedAt    DateTime  @default(now())
  expiresAt    DateTime
  nextSendAt   DateTime
  lastSentAt   DateTime?
  site Site @relation(...)
  createdBy User @relation(...)
  metrics EmailTaskMetric[]
  recipients EmailRecipient[]
  sendEvents EmailSendEvent[]
}

model EmailTaskMetric {
  id          String  @id @default(cuid())
  emailTaskId String
  panelId     Int
  panelTitle  String
  operator    String? // optional — informational annotation only, no alerting
  threshold   Float?
  emailTask EmailTask @relation(...)
}

model EmailRecipient {
  id          String @id @default(cuid())
  emailTaskId String
  email       String
  kind        String // "to" | "cc"
  emailTask EmailTask @relation(...)
}

model EmailSendEvent {
  id             String   @id @default(cuid())
  emailTaskId    String
  sentAt         DateTime @default(now())
  success        Boolean
  errorMessage   String?
  recipientCount Int
  emailTask EmailTask @relation(...)
}
```

### 4.1 Why dashboard moved off `Site`

The pilot's `Site.dashboardUid` assumed one dashboard per site. Once a site
became "a Grafana instance" (which can host many dashboards), that
assumption broke — dashboard selection had to move to whichever thing
actually watches ONE dashboard, which is a task (`MonitorTask`/`EmailTask`),
not the site. This was deliberately sequenced late (after auth, sites, and
the Grafana refactor were already stable) so each migration stayed focused.

### 4.2 Why `NotificationRecipient` + `RecipientAlertThread` are two tables

`NotificationRecipient` is "who to DM." `RecipientAlertThread` is "which
Slack thread does *this* metric's conversation with *this* recipient live
in." They're separate because cooldown is one shared clock per metric
(`TaskMetric.lastAlertAt`) but threading is inherently per-person — Alice
and Bob each have their own DM conversation with the bot, so a repeat
breach must reply in each of their own threads independently, even though
both are gated by the same cooldown timer.

### 4.3 Why `EmailTaskMetric.operator`/`threshold` are optional

Email is a **report**, not a second alerting system — no cooldown, no
threading, no Slack-style dedup. But the spec wanted reports to be able to
annotate "over/under threshold" as context. Making these two fields
nullable gets that without duplicating any of Slack's alerting machinery
internally.

## 5. Authentication

`lib/passwords.ts` — `crypto.scrypt`-based hash/verify, format
`"salt:hash"` in one column, no new dependency. Login
(`app/api/auth/login/route.ts`) compares against the stored hash and
returns the same error for "no such user" and "wrong password." The
session is unchanged in shape from the pilot — an httpOnly cookie holding
`user.id` — but is now gated by a real password instead of trust.

`middleware.ts` (new) does a fast, edge-safe presence check on the session
cookie for every route except `/login` and the login API, redirecting to
`/login` if absent. This is **defense in depth, not the authoritative
check** — edge middleware can't query SQLite, so every protected page still
calls `getCurrentUser()` (a real DB lookup) itself.

The shared `CAC Engineer` account is seeded from `CAC_ENGINEER_USERNAME`/
`CAC_ENGINEER_PASSWORD` env vars (`prisma/seed.ts`) — never hardcoded,
never in frontend code. Adding individual users later is just adding more
`User` rows with their own credentials; nothing about the schema or login
flow assumes there's only one account.

## 6. Sites: model, seeding, and adding new ones

**The 31-site seed** (`prisma/siteSeedData.ts`) is the user-provided list
with two confirmed copy-paste duplicates removed (`GXO-A&F` appeared twice
with different hyphenation; `GXO-H&M` appeared as an exact duplicate).
Every other name is preserved **verbatim** — no normalization of
similar-looking names, per explicit instruction. `lib/siteSlug.ts` derives
a stable machine slug from each name (lowercase, `&`→`and`, punctuation→
hyphens) without ever touching the display name.

`prisma/seed.ts`'s site-seeding is an idempotent upsert-by-slug — safe to
re-run, and checks for slug collisions before writing anything.

**Adding a new site today** (no admin UI yet, by design — see §14): add a
name to `INITIAL_SITE_NAMES` in `prisma/siteSeedData.ts` and re-run
`npm run db:seed`, or insert a `Site` row directly (`name`, `slug`,
`grafanaBaseUrl`, optionally `grafanaApiToken`). The backend foundation for
a real site-management API already exists as a pattern in
`app/api/sites/route.ts` (GET with search/filter/sort/pagination) — adding
`POST`/`PATCH` there for a future admin UI is a small, contained addition,
not a new subsystem.

**Pointing a site at its real Grafana**: update that one `Site` row's
`grafanaBaseUrl` (and `grafanaApiToken` if it needs its own credential
instead of the shared env one). No other code changes — every Grafana call
in the app already resolves config per-site via `resolveSiteGrafanaConfig`.

## 7. Grafana integration (per-site)

`lib/grafana.ts` functions all take a `GrafanaConfig { baseUrl, token }`
resolved per-site, instead of reading one global env client:

| Function | Purpose |
|---|---|
| `listDashboards(config)` | `GET /api/search?type=dash-db` — every dashboard on that instance. Powers the dashboard-discovery step of task creation. |
| `getPanels(config, dashboardUid)` | `GET /api/dashboards/uid/{uid}` — panels on a specific dashboard, once one's chosen. |
| `queryMetricValue(config, dashboardUid, panelId)` | Re-issues the panel's own stored query against `/api/ds/query` — works against any datasource type with zero per-datasource logic (proven again in Phase 13 by adding `stat`/`gauge` panels with zero code changes). |
| `captureScreenshot(config, dashboardUid, panelId)` | `/render/d-solo/...` — used by both Slack alerts and email reports. |

## 8. Slack monitoring (per-site, multi-metric, multi-recipient)

Creation flow (`app/sites/[slug]/slack-tasks/new`): pick a dashboard
(searchable, discovered live) → pick one or more panels on it → per-panel
operator+threshold → shared poll interval/cooldown/duration → optional
Slack recipients (chip-based add/remove, `U...` member IDs).

Worker (`worker/index.ts`, `processMetric`): each metric, each tick,
independently — evaluate, and on breach past cooldown: post/thread the L3
channel alert, then loop over the task's recipients **each in its own
try/catch**, resolving/creating a `RecipientAlertThread` per recipient so
each person's repeat breaches thread correctly in their own DM. A failed
recipient DM never undoes the L3 post or blocks any other recipient — this
was directly proven with a real broken Slack ID during testing (§13).

Poll/API failures now DM **every configured recipient** on the task
(`notifyCreatorOfFailure`, called once per recipient) — there's no single
"creator" identity left to fall back to under the shared login, so this is
the closest faithful translation of the pilot's original "a broken tool is
the requester's problem, not L3's" reasoning.

## 9. Email monitoring (scheduled reports)

Creation flow (`app/sites/[slug]/email-tasks/new`) mirrors Slack's exactly
for dashboard/panel discovery, but: thresholds are optional (informational
only), there are separate To/CC recipient lists (email addresses, not
Slack IDs), and interval presets are much coarser (`EMAIL_INTERVAL_PRESETS_MIN
= [60, 240, 720, 1440]` — 1h/4h/12h/24h) specifically so a report task
can't be configured to spam an inbox every minute the way a Slack poll
reasonably can.

`lib/email.ts` defines an `EmailProvider` interface; `EtherealEmailProvider`
is the sandbox implementation — a disposable fake-SMTP account, nothing
ever actually delivered, every send returns a preview URL. A real provider
(SES, SendGrid, an internal relay) implements the same interface later.
`lib/emailTemplate.ts` renders a table-based HTML email with inline styles
(the only style that survives real email clients) — site name, timestamp,
each metric's value with screenshot inlined via `cid:` attachment, an
optional threshold/breach annotation, and a graceful per-metric error row
if that panel couldn't be read — never a raw JSON dump.

Worker (`emailTick`/`processEmailTask`): same DB-driven `nextSendAt`
pattern as Slack's `nextCheckAt`. One metric failing degrades to an error
row in the report rather than aborting the whole send; one task failing
(bad Grafana config, send rejected) is isolated from every other task,
Slack or email, in the same tick.

## 10. Local Grafana sandbox

`provisioning/dashboards/site-a.json` now has 10 panels across 3
visualization types — `timeseries` (Rack-to-Rack Time, Orderline
Throughput, Per-Unit OWT — the original 3, unchanged), `stat` (Assigned/
Logged-In PPS, Per-Face OWT, Open/Completed Orders), and `gauge` (Picks Per
Rack Face, PPS UPH) — mirroring the reference GreyOrange dashboard's
structure with dummy `TestData` random-walk values. Confirmed live that
`queryMetricValue`/`captureScreenshot` work identically against every panel
type with no code changes.

## 11. Home page (site directory)

`GET /api/sites` — search (name contains), `redZone`/`f90`/`slackActive`/
`emailActive` boolean filters, sort (name/most-active/most-breached), and
**cursor-based pagination** (an opaque cursor = the last returned site's
id in the current sort order; correct because the sort is deterministic).
Active-task and breached-metric counts are computed via **one query each**
(`monitorTask.findMany`/`emailTask.findMany` with a `select`, reduced in
memory into per-site maps) rather than a per-site N+1 lookup — explicitly
chosen and verified at this scale (tens of sites) over a raw-SQL groupBy
across the relation chain.

`lib/status/redZone.ts` and `lib/status/f90.ts` are the mock status
provider — deterministic per site (a stable hash, not random-per-request),
completely decoupled from the `Site` model and from every UI component
that reads them. Swapping in real Red Zone/F90 APIs later means rewriting
the body of these two functions and nothing else.

## 12. Environment variables

```
# Grafana (shared fallback — per-site override lives in the Site table)
GRAFANA_BASE_URL=
GRAFANA_API_TOKEN=

# Slack
SLACK_BOT_TOKEN=
L3_CHANNEL_ID=

# App
DATABASE_URL="file:./dev.db"
PORT=3000

# Auth — read once at seed time, never at runtime
CAC_ENGINEER_USERNAME=
CAC_ENGINEER_PASSWORD=

# Email — optional, defaults to a placeholder; only matters once a real
# provider (which usually validates the From domain) replaces Ethereal
EMAIL_FROM=
```

## 13. What was actually verified (live, not just typechecked)

Every phase was checked against the running sandbox as it was built, not
just code-reviewed. Highlights:

- Full auth flow: valid/invalid login, protected-route redirect via
  middleware, logout — via direct HTTP calls against the running app.
- 31-site seed: exact count, zero slug collisions, idempotent on a second
  run, all correctly served through the live `/api/sites` API.
- Dashboard discovery + panel loading through the real sandbox for a
  non-default site (IKEA), including the worker itself successfully using
  a task-level `dashboardUid` to pull a real value.
- Multi-metric + multi-recipient breach, with a **deliberately broken**
  Slack recipient ID: confirmed the L3 alert and the working recipient's
  DM both succeeded with independent threads, the broken recipient failed
  in isolation (`user_not_found`, caught, logged), and a genuine repeat
  breach past cooldown reused **both** threads correctly across two
  separate cycles.
- Email: a real Ethereal send with a **fetched and independently
  confirmed** rendered email (correct subject/to/cc, real metric value,
  correct threshold annotation, a graceful error row for a deliberately
  bogus panel, a real inline screenshot). Confirmed `nextSendAt` advances
  by exactly `intervalMin`, and confirmed restart-safety by starting a
  completely fresh worker process and watching it correctly pick up and
  send a due task purely from DB state.
- Cross-site isolation: created tasks (Slack and email) under two
  different sites and confirmed each site's task list shows only its own,
  while the global `/tasks` view still shows both.
- A full combined integration pass: one login session creating a
  multi-metric/multi-recipient Slack task **and** a multi-recipient email
  task on the same site, running the worker once, and confirming both
  processed correctly in the same tick cycle with the site details page
  reflecting real live counts for both immediately afterward.
- `tsc --noEmit`, `eslint`, and `next build` clean after every phase.

## 14. Known limitations (explicitly deferred, not overlooked)

- **No site-management admin UI.** Adding a site means editing
  `siteSeedData.ts` or writing a DB row directly — the API foundation
  (`GET /api/sites` with full filtering) exists, but `POST`/`PATCH` routes
  and a UI for them aren't built.
- **Red Zone / F90 are mocked**, deterministic-per-site, not real signals —
  by design, pending real APIs (§11).
- **No task-history UI page** — `GET /api/tasks/[id]/events` exists and was
  verified to return correct per-check history, but nothing in the UI
  links to it yet.
- **Email intervals are coarse by design** (1h minimum) — intentional, not
  a bug, to prevent inbox spam; revisit if a real use case needs finer
  granularity.
- Same pilot-era limitations still apply: SQLite is a single-machine
  choice (fine for this scale, would need Postgres for real concurrent
  multi-instance deployment); the app and worker still only run on
  whichever machine starts them — no always-on deployment yet.

## 15. Future integration points

- Real per-site Grafana URLs/tokens — set directly on each `Site` row, no
  code changes.
- Real Red Zone / F90 APIs — rewrite `lib/status/redZone.ts` /
  `lib/status/f90.ts` only.
- Individual users / organizational SSO — `User.role` and the
  username+password model are already structured for this; swapping in
  SSO replaces the login route, not the schema.
- Real email provider — implement `EmailProvider` (`lib/email.ts`) against
  SES/SendGrid/an internal relay, configure via env, done.
- Opsgenie or other incident-management integration — not built; the
  explicit boundary drawn in this build is that GreyWatch is self-service
  ad hoc monitoring, not a replacement for existing incident-management
  tooling, so this would be a deliberate new integration point, not
  something implied by the current architecture.
