# Implementation Plan — GreyWatch Multi-Site Platform

Companion to `IMPLEMENTATION_ANALYSIS.md`. Executed phase by phase, each
checkpointed with lint/typecheck/build and a live sandbox check before
moving to the next. Two decisions already confirmed with the user: the site
list dedupes to **31 unique sites**, and sandbox email uses **Ethereal**
(fake SMTP, swapped for a real provider later via `.env`).

---

## Phase 1 — Authentication and User model

**Goal**: Replace username+Slack-ID login with a real username+password
login for a shared `CAC Engineer` account, while keeping the User model
ready for individual users later.

**Database changes**: `User` gains `passwordHash String`, `role String
@default("engineer")`. `slackUserId` is removed from `User` (moves to
`NotificationRecipient` in Phase 9). Requires a destructive migration on
existing pilot data — **will confirm with the user before running it**,
same as the earlier multi-metric migration.

**Backend changes**: `lib/passwords.ts` (scrypt hash/verify, Node's built-in
`crypto` — no new dependency). `lib/auth.ts` updated: `verifyLogin(username,
password)`, session cookie unchanged in shape (still just `user.id`).
`app/api/auth/login/route.ts` validates username+password instead of
username+Slack-ID. `prisma/seed.ts` upserts the `CAC Engineer` account from
`CAC_ENGINEER_USERNAME`/`CAC_ENGINEER_PASSWORD` env vars (never hardcoded).

**Frontend changes**: `app/login/page.tsx` — password field instead of
Slack member ID field.

**New file**: root `middleware.ts` — centralized redirect-to-`/login` for
any unauthenticated request to a protected route, replacing today's
per-page manual checks (defense in depth: pages can keep their own check
too, but shouldn't need to be the only line of defense).

**Risks**: this is the change every other page currently depends on
(`getCurrentUser()`); must audit every call site.

**Tests**: valid login succeeds, invalid password/username rejected,
visiting a protected route while logged out redirects to `/login`, logout
clears the session, `CAC Engineer` seed is idempotent.

**Definition of Done**: `tsc`/`eslint`/`build` clean; live login test
(correct + incorrect credentials) against the running dev server.

---

## Phase 2 — Site model, migrations, and initial site seed data

**Goal**: Replace the single-site model with a real multi-site `Site`
table and seed the 31 confirmed sites.

**Database changes**: `Site` gains `slug String @unique`, `grafanaBaseUrl
String`, `grafanaApiToken String?` (nullable — falls back to the shared env
token when unset), `isActive Boolean @default(true)`, `updatedAt
DateTime @updatedAt`. `dashboardUid` is **removed** from `Site` (moves to
task-level in Phase 3, since one Grafana instance hosts many dashboards).

**Backend changes**: `prisma/seed.ts` gets an idempotent site-seeding
function (upsert by `slug`) for the 31-name list (deduped per the user's
confirmation), all with `grafanaBaseUrl` pointed at the existing sandbox
(`http://localhost:3001`) and `grafanaApiToken: null` (shares the env
token). Slugs are generated deterministically from each name (lowercased,
`&`→`and`, spaces/punctuation→`-`) so re-running the seed is stable.

**Risks**: exact-duplicate slugs after normalization (e.g. two names that
differ only in casing/hyphenation) — checked programmatically before
seeding, not just eyeballed.

**Tests**: seed runs twice with no errors and no duplicate rows; all 31
sites present with correct names; `isActive` defaults true.

**Definition of Done**: `npx prisma studio` (or a query script) shows
exactly 31 `Site` rows with unique slugs.

---

## Phase 3 — Site management foundation and APIs

**Goal**: Make `lib/grafana.ts` work against *any* site's Grafana instance,
not a single global one, and add dashboard discovery.

**Backend changes**: `lib/grafana.ts` functions (`getPanels`,
`queryMetricValue`, `captureScreenshot`) take a resolved `{baseUrl, token}`
parameter instead of reading `grafanaEnv` directly; a new
`resolveSiteGrafanaConfig(site)` helper picks `site.grafanaApiToken ??
grafanaEnv.GRAFANA_API_TOKEN`. New `listDashboards(baseUrl, token)` calling
Grafana's `/api/search?type=dash-db`. New API routes:
`GET /api/sites/[slug]/dashboards` (list), `GET
/api/sites/[slug]/dashboards/[dashboardUid]/panels` (replaces the old
site-level panels route). `GET /api/sites` gets search/filter/sort/cursor
query-param support (used by Phase 4). `POST /api/sites`, `PATCH
/api/sites/[slug]` for future site management (create/edit/activate),
per the spec's "backend/service foundation for future site management"
ask — no admin UI yet, but the API exists and is documented.

**Risks**: every existing Grafana call site needs updating in the same pass
or the app won't build — this phase is all-or-nothing within itself.

**Tests**: dashboard discovery against the sandbox returns the seeded
`site-a` dashboard; panel discovery still returns the 3 known panels;
existing worker/API Grafana calls still typecheck.

**Definition of Done**: `npm run test:grafana`-style live check confirms
dashboard listing + panel discovery both work through the new
site-parameterized functions.

---

## Phase 4 — Home page: site cards, search, filters, sort, pagination

**Goal**: The primary post-login page — a scalable directory of all sites.

**New files**: `lib/status/redZone.ts`, `lib/status/f90.ts` (mock
provider — deterministic per-site pseudo-status, isolated behind a
`getSiteStatus(siteId)`-shaped interface so a real API swap later touches
only these files). `app/page.tsx` rewritten as the site directory (or a
new route if keeping `/` as a thin redirect is cleaner — decided during
implementation based on what reads best).

**Backend changes**: `GET /api/sites` returns paginated (cursor-based)
results with: search (name contains), `redZone`/`f90`/`slackActive`/
`emailActive` boolean filters, active-task-count and breached-count ranges,
sort. Task/breach counts computed via **grouped** Prisma queries
(`groupBy` on `siteId`), not per-site N+1 lookups.

**Frontend changes**: site cards (name, Red Zone/F90 badges, Slack task
count, breach count, email status), search input, filter controls, sort
control, infinite-scroll loading (IntersectionObserver-triggered next-page
fetch).

**Risks**: the #1 named risk from the analysis — N+1 queries across 31
sites. Verified explicitly (see tests).

**Tests**: all 31 sites reachable via scroll; search narrows correctly;
each filter individually verified; query count checked (e.g. via Prisma
query logging) to confirm no N+1 pattern.

**Definition of Done**: live Playwright pass — load, search, filter, sort,
scroll to the end, screenshot in both themes.

---

## Phase 5 — Site Details operational overview

**Goal**: `app/sites/[slug]/page.tsx` — the per-site landing page with
Slack Monitoring and Email Monitoring summary cards.

**Backend changes**: a site-detail API/query aggregating: active Slack task
count, per-metric breach status, active email task count + next-send
summary.

**Frontend changes**: two cards as specified (Slack: status, active count,
breach summary, "view all"/"create new" actions; Email: active count,
recipient/interval summary, "view all"/"create new" actions). The selected
site name is always visible in the page header.

**Tests**: navigating from a home-page card lands on the right site;
counts match the underlying data; empty states (no tasks yet) render
correctly.

**Definition of Done**: live check against at least one seeded site with a
real task and one with none.

---

## Phase 6 — Site-specific Slack task list

**Goal**: Move the existing task list under the site route, scoped to that
site only.

**Frontend changes**: `app/tasks/page.tsx`'s logic moves to
`app/sites/[slug]/slack-tasks/page.tsx`, filtered by `siteId`, reusing the
existing nested-metrics table markup as-is. The global `/tasks` route is
kept as a secondary "all sites" cross-site view (useful for an ops-wide
glance) rather than removed — not required by the spec, but doesn't
conflict with it and preserves a working view.

**Tests**: only the selected site's tasks appear; "create new" links into
the site-scoped creation flow from Phase 7.

**Definition of Done**: live check with 2+ sites each holding tasks —
confirm no cross-site leakage.

---

## Phase 7 — Enhanced Slack task creation and Grafana discovery

**Goal**: Site-scoped task creation using the Phase 3 dashboard-discovery
APIs, with the Site dropdown removed entirely.

**Database changes**: `MonitorTask` gains `dashboardUid String` (the
task-level dashboard selection that used to live on `Site`).

**Frontend changes**: `app/sites/[slug]/slack-tasks/new/page.tsx` — no site
selector (site is fixed by the route); a searchable dashboard dropdown
(new) feeding the existing `MetricPicker` component, which needs its panel
source switched from "all panels of the site's one dashboard" to "all
panels of the selected dashboard." Operator options stay as they are
(generic `gt/gte/lt/lte/eq`) — units are displayed where Grafana's panel
config reports one, with a plain "no unit reported" fallback where it
doesn't (never a fabricated unit).

**Tests**: dashboard search/select works; panel list updates on dashboard
change; task creation still produces correct `MonitorTask`+`TaskMetric`
rows.

**Definition of Done**: create a real multi-metric task through the new
flow against the sandbox and confirm it appears correctly in Phase 6's
list.

---

## Phase 8 — Multiple metric monitoring

**Status: already implemented and verified** in the existing pilot
(`TaskMetric`, independent per-metric evaluation/cooldown/threading,
per-metric error isolation in the worker). This phase's remaining work is
purely making sure it **still holds** after Phases 3/7's dashboard-selection
refactor — no new capability to build, just regression verification.

**Tests**: re-run the exact multi-metric verification already proven
earlier in this project (2 real metrics + 1 deliberately broken panel ID
in one task) through the new site-scoped, dashboard-aware creation flow.

**Definition of Done**: same pass/fail bar as the original verification —
independent breach detection, independent threading, one bad metric never
blocking the others.

---

## Phase 9 — Multiple Slack recipients

**Goal**: Replace the single "DM the creator" concept with a configurable
list of Slack recipients per task.

**Database changes**: new `NotificationRecipient { id, taskId, slackUserId,
createdAt }`. New `RecipientAlertThread { id, metricId, recipientId,
threadTs }`, unique on `(metricId, recipientId)` — cooldown stays one
shared clock per metric (`TaskMetric.lastAlertAt`), but each recipient gets
their own independent DM thread. `MonitorTask.notifyCreator` and
`TaskMetric.creatorThreadTs` are removed (superseded by the above).

**Backend/worker changes**: `worker/index.ts`'s breach-alert step loops
over a metric's task's recipients, resolving/creating each one's
`RecipientAlertThread` row, posting via the existing `postBreach()`, with
**per-recipient try/catch** so one broken DM never affects the L3 alert or
any other recipient (same isolation discipline already proven for
per-metric failures). `lib/slack.ts`'s `notifyCreatorOfFailure` becomes
`notifyTaskFailure(recipients, ...)`, DMing every configured recipient
instead of a single creator.

**Frontend changes**: add/remove recipient controls (Slack member ID input
+ chip list) on the task creation form from Phase 7.

**Tests**: create a task with 2 recipients, force a breach, confirm both
get independent DM threads; force a repeat breach, confirm both DMs thread
correctly; simulate one recipient's DM failing (e.g. a malformed ID) and
confirm the channel alert and the other recipient are unaffected.

**Definition of Done**: the above tests pass live against the sandbox
Slack workspace.

---

## Phase 10 — Email task database model and backend

**Goal**: Data model and provider abstraction for scheduled email reports.

**Database changes**:
```
EmailTask       { id, siteId, dashboardUid, intervalMin, status,
                  createdById, startedAt, expiresAt, nextSendAt,
                  lastSentAt, createdAt, updatedAt }
EmailTaskMetric { id, emailTaskId, panelId, panelTitle }
EmailRecipient  { id, emailTaskId, email, kind }   // kind: "to" | "cc"
EmailSendEvent  { id, emailTaskId, sentAt, success, errorMessage,
                  recipientCount }
```

**New file**: `lib/email.ts` — an `EmailProvider` interface
(`send({to, cc, subject, html, attachments})`), with `EtherealProvider` as
the sandbox implementation (creates a test account via Nodemailer's
Ethereal integration, logs the preview URL for every send). A real
provider (SES/SendGrid/SMTP relay/etc.) implements the same interface
later — swapped via `.env`, no application code changes, mirroring the
Grafana/Slack sandbox-to-real pattern already established.

An HTML email template (site name, status, each selected metric's current
value/threshold/breach state, timestamps, the same screenshot capture
already used for Slack) — never a raw JSON dump, per the spec.

**Tests**: `scripts/test-email.ts` (mirroring the existing
`test-grafana.ts`/`test-slack.ts` pattern) sends one real test email
through Ethereal and prints the preview URL.

**Definition of Done**: a real Ethereal send succeeds and is viewable via
its preview URL.

---

## Phase 11 — Email task UI

**Goal**: Site-scoped list + creation form for email tasks.

**Frontend changes**: `app/sites/[slug]/email-tasks/page.tsx` (list:
active/inactive, interval, recipients, last/next send, status) and
`app/sites/[slug]/email-tasks/new/page.tsx` (interval preset, to/cc
recipient chip inputs, dashboard+metric selection reusing Phase 7's
picker, duration).

**Backend changes**: `app/api/sites/[slug]/email-tasks/**` CRUD routes
mirroring the Slack task API shape.

**Tests**: create an email task, confirm it's scoped to the right site,
confirm it appears only in that site's list.

**Definition of Done**: live creation + list verification.

---

## Phase 12 — Worker support for email scheduling and delivery

**Goal**: The worker's tick loop also processes due email tasks.

**Worker changes**: a second due-query (`EmailTask` where `status=active
AND nextSendAt <= now`), each processed in its own try/catch (task-level
isolation — one failing task/recipient must not affect others), fetching
current values for its selected metrics, generating the HTML report,
sending via `lib/email.ts`, recording an `EmailSendEvent`, updating
`nextSendAt = now + intervalMin` and `lastSentAt = now`. This reuses the
exact DB-driven-state pattern (`nextSendAt` instead of `nextCheckAt`) that
already makes the Slack loop crash/restart-safe — no in-memory scheduling.

**Tests**: an email task with a 1-minute interval sends on schedule across
several ticks; a deliberately broken recipient/config on one task doesn't
stop other tasks (Slack or email) from processing in the same tick;
restart the worker mid-run and confirm scheduling resumes correctly from
the DB state.

**Definition of Done**: multiple real scheduled sends observed via
Ethereal preview URLs over a live multi-tick run.

---

## Phase 13 — Local Grafana sandbox: realistic dummy dashboard

**Goal**: Update the sandbox dashboard(s) to structurally mirror the
reference GreyOrange dashboard (KPI/stat panels, gauges, time-series —
Pick/Put mode, Rack-to-Rack time, Picks Per Rack Face, PPS/UPH, OWT,
Orderline Throughput, Open/Completed Orders) using dummy `TestData`-driven
values — not real data, not necessarily matching the reference's exact
numbers.

**Changes**: `provisioning/dashboards/site-a.json` extended (or a new
provisioned dashboard) with additional panels of the above kinds, each a
`TestData` `random_walk` (or `csv_content` where a fixed-shape KPI number
reads better than a walk) tuned to realistic ranges, matching the existing
provisioning pattern already in place.

**Tests**: dashboard loads in Grafana; each new panel type (stat/gauge/
time-series) discoverable and queryable through the app's existing
Phase 3 dashboard/panel APIs; screenshot capture still works on the new
panels.

**Definition of Done**: a Slack and/or email task can be created against at
least one of each new panel type and produces a correct alert/report.

---

## Phase 14 — End-to-end testing, sandbox verification, bug fixing

**Goal**: Run the full acceptance flow from the original request (the
64-step list) for real against the sandbox, fix whatever breaks.

**Covers**: auth (valid/invalid login, protected routes, logout), sites
(directory, search, all filters, sort, pagination), site details (both
summary cards), Slack monitoring (site-scoped list, dashboard/panel
discovery, single + multiple metrics, multiple recipients, breach +
cooldown + dedup, history), email monitoring (site-scoped list, multiple
to/cc recipients, interval, activation, scheduled send, professional
formatting, screenshot inclusion, send history, failure handling),
database (migrations, seed idempotency, relationships, data preservation
where applicable), worker (multi-metric, multi-recipient, email delivery,
restart recovery, failure isolation).

**Definition of Done**: every one of the 64 steps either passes live or is
explicitly logged as untestable-with-reason in the final report — nothing
marked done without having actually been run.

---

## Post-implementation

- Refresh `context.md` with everything from this plan that actually shipped
  (architecture, schema, new APIs, env vars, known limitations, future
  integration points for real Grafana URLs / Red Zone / F90 / SSO / real
  email provider / Opsgenie).
- Final implementation report per the user's requested 20-point structure.
