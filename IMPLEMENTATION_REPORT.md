# Implementation Report — GreyWatch Multi-Site Platform

All 14 phases from `IMPLEMENTATION_PLAN.md` are complete and verified live
against the sandbox (Grafana + Slack + Ethereal), not just typechecked.
Full detail lives in `context.md`; this is the concise summary requested.

## 1. What was changed

Evolved the single-site pilot into a 31-site platform: real shared-account
auth, per-site Grafana instances with dashboard discovery moved to
task-creation time, multi-recipient Slack alerting, and an entirely new
scheduled-email-report subsystem — plus a real home page (search/filter/
sort/pagination) and site-details overview tying it all together.

## 2. Existing functionality preserved

The pilot's core mechanics are unchanged in spirit: per-metric independent
evaluation, cooldown, Slack threading, screenshot-on-breach (never OCR),
the DB-driven/restart-safe worker tick pattern, and the "reuse each
panel's own query, no per-datasource logic" design (re-proven in Phase 13
by adding `stat`/`gauge` panels with zero code changes). Nothing was
rewritten without a specific reason tied to the new requirements.

## 3. Authentication implementation

Shared `CAN Engineer` username+password login. Passwords hashed with
Node's built-in `crypto.scrypt` (no new dependency). Session is still a
simple httpOnly cookie holding `user.id`. New root `middleware.ts` adds
centralized route protection (edge-safe presence check; pages still do
their own authoritative DB check). `User.role` exists now, unused, so
individual users/RBAC don't need another migration later.

## 4. New database entities / changes

11 tables total. New: `NotificationRecipient`, `RecipientAlertThread`,
`EmailTask`, `EmailTaskMetric`, `EmailRecipient`, `EmailSendEvent`.
Changed: `Site` gained `slug`/`grafanaBaseUrl`/`grafanaApiToken`/
`isActive` and lost `dashboardUid` (moved to `MonitorTask`/`EmailTask`,
since a site is now a Grafana instance, not one fixed dashboard). `User`
gained `passwordHash`/`role` and lost `slackUserId` (superseded by
per-task recipients). Full rationale for each in `context.md` §4.

## 5. Initial site data added

31 sites (the provided 33-name list minus two confirmed copy-paste
duplicates — `GXO-A&F`/`GXO A&F` and a literal repeat of `GXO-H&M` —
confirmed with you before seeding). All names preserved exactly as given;
all pointed at the sandbox Grafana for now.

## 6. How additional sites can be added

Add a name to `prisma/siteSeedData.ts` and re-run `npm run db:seed`
(idempotent, upserts by slug), or insert a `Site` row directly. `GET
/api/sites` already supports full search/filter/sort/pagination as a
foundation for a future site-management API; `POST`/`PATCH` routes for an
admin UI aren't built yet (no UI need identified this phase).

## 7. New APIs/services

`app/api/sites/[siteId]/dashboards`, `.../dashboards/[uid]/panels`,
`app/api/email-tasks` (+ `[id]/stop`), extended `GET /api/sites`
(search/filter/sort/cursor pagination). `lib/status/redZone.ts` and
`lib/status/f90.ts` as isolated mock-data providers. `lib/email.ts`
(`EmailProvider` interface) and `lib/emailTemplate.ts` (HTML rendering).

## 8. New Home/Site flows

`/` is now the real site directory (cards, search, Red Zone/F90/Slack-
active/Email-active filters, sort, infinite scroll). `/sites/[slug]` is
the operational overview (Slack + Email cards with live counts).
`/sites/[slug]/slack-tasks` and `/sites/[slug]/email-tasks` (+ `/new`) are
the site-scoped task lists and creation flows. The old global `/tasks/new`
redirects to the site directory rather than 404ing.

## 9. Slack monitoring changes

Dashboard discovery replaces the old site-dropdown flow; the site is fixed
by the route, never re-selected. Everything else (multi-metric picker,
cooldown, per-metric threading) carried forward and was re-verified
through the new flow.

## 10. Multiple metric support

Unchanged from the pilot (already existed) — re-verified end-to-end
through the new dashboard-per-task flow, including the original
error-isolation test (one bad panel ID never blocks the others in the same
task).

## 11. Multiple Slack recipient support

New `NotificationRecipient`/`RecipientAlertThread` tables. Each recipient
gets an independently-threaded DM, isolated per-recipient try/catch. Poll
failures now DM every recipient, not a single "creator" (which no longer
exists under the shared login). Verified live with a deliberately broken
recipient ID across two separate breach cycles.

## 12. Email monitoring implementation

Full scheduled-report subsystem: dashboard/panel discovery reused from
Slack, optional threshold annotations (informational, not alerting),
separate To/CC recipient lists, coarser interval presets (1h–24h) to
prevent inbox spam. `EtherealEmailProvider` for the sandbox; a real
provider swaps in behind the same interface.

## 13. Background worker changes

Two independent tick loops (Slack `nextCheckAt`, email `nextSendAt`), same
DB-driven/restart-safe pattern for both. Task-level isolation for email
(one task's failure doesn't affect others); metric-level graceful
degradation for email (one unreadable panel becomes an error row, not an
aborted send).

## 14. Grafana sandbox changes

Dashboard extended from 3 to 10 panels across `timeseries`/`stat`/`gauge`
types, mirroring the reference dashboard's structure with dummy data.
Confirmed the existing query/screenshot pipeline needed zero changes for
the new panel types.

## 15. Tests performed

Live, not just typechecked, at every phase: real HTTP auth flows, real
Grafana queries/screenshots against the sandbox (including new panel
types), real Slack messages/threads/DMs (including a deliberately broken
recipient), real Ethereal email sends with **independently fetched and
verified** rendered content, real worker restarts proving DB-driven
scheduling recovery, and cross-site isolation checks for both Slack and
email tasks. `tsc --noEmit`/`eslint`/`next build` clean after every phase.

## 16. Sandbox verification results

All of the acceptance flow's authentication, sites, site-details, Slack
monitoring, and email monitoring sections passed live. See `context.md`
§13 for the specific checks and what each one proved.

## 17. Bugs found and fixed during this expansion

- A stale in-memory `@prisma/client` in an already-running dev server
  caused `grafanaBaseUrl` to read as `undefined` after a schema change —
  caught immediately via live testing, fixed by restarting the process.
  Worth remembering: Node doesn't hot-reload `node_modules` code, only
  Next.js's own app code.
- Missed adding `EmailTask.durationMin` and `Site`'s eventual
  `dashboardUid` removal sequencing on the first pass of their respective
  schema edits — caught by the type checker and by the migration's own
  data-loss warning before anything broke.
- Prisma's non-interactive `migrate dev` guard blocked a column-drop with
  existing (trivial, reseedable) data — resolved by recreating the empty
  dev DB rather than fighting the interactive prompt, since the dropped
  data was pure seed config, not user work.
- Test-timing lesson repeated from the pilot: worker ticks involving a
  real screenshot + Slack/email send routinely take 40–70 seconds under
  this sandbox, not the 10-second window an impatient test script assumes
  — every verification in this phase used long-enough windows after
  hitting this once early on.

## 18. Anything that could not be tested

- No real per-site Grafana URL, real Slack workspace, or real email
  provider exists yet — everything is verified against sandbox
  equivalents by design (per the agreed plan), not the real GreyOrange
  systems.
- No load/concurrency testing at real team scale (tens of engineers, many
  simultaneous tasks) — this is a single-developer sandbox pilot.
- The task-history UI (as opposed to the underlying, verified-working API)
  wasn't built — no page currently links to `/api/tasks/[id]/events`.

## 19. Remaining limitations

See `context.md` §14 in full: no site-management admin UI (API foundation
exists), Red Zone/F90 are deterministic mocks pending real APIs, email
intervals are deliberately coarse, and SQLite/no-deployment-target remain
pilot-scale choices carried over from before this expansion.

## 20. Recommended next steps before organizational production deployment

1. Get real Grafana URLs (and, where needed, per-site tokens) for the
   sites that matter first — start with a handful, not all 31 at once.
2. Get a real Slack app approved for the actual GreyOrange workspace with
   the same scopes already documented in `SETUP.md`.
3. Choose and wire up a real email provider (`lib/email.ts`'s interface is
   ready) — SES/SendGrid/an internal relay, whatever GreyOrange already
   trusts.
4. Decide on a real hosting target — the app and worker currently only run
   on whichever machine starts them.
5. Revisit auth before opening this to more than the current shared
   account — individual logins or SSO, using the `User.role` groundwork
   already in place.
6. If concurrent multi-instance use becomes real, move off SQLite to
   Postgres — a schema-level change, not an architectural one.
