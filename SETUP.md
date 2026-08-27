# Setup

Everything below gets you from a fresh clone to a working end-to-end demo on
**sandbox** data (a local Grafana + a throwaway Slack workspace). When you're
ready to point this at the real GreyOrange Grafana/Slack, only the values in
`.env` change — none of the code does.

## 0. Prerequisites

- Node.js 20+, npm
- Docker Desktop (must actually be running — `docker info` should succeed)

## 1. Grafana (sandbox)

### 1.1 Start Grafana + the renderer sidecar

```bash
docker compose up -d
```

This starts two containers:
- `grafana` on `http://localhost:3001` (port 3001, not 3000, so it doesn't clash with the Next.js dev server)
- `renderer` (`grafana-image-renderer`), which Grafana calls internally to turn a panel into a PNG

It also auto-provisions (via `provisioning/`) a `TestData` datasource and a
`site-a` dashboard with 3 panels that mimic the real fulfillment metrics
(Rack-to-Rack Time, Orderline Throughput, Per-Unit OWT), each wandering
through realistic values so thresholds trip periodically without you having
to fake anything.

Wait for it to be healthy:
```bash
until curl -sf http://localhost:3001/api/health >/dev/null; do sleep 2; done
```

### 1.2 Log into Grafana and create a service account token

1. Open `http://localhost:3001` — log in with `admin` / `admin` (it'll prompt you to change the password; you can skip that for the sandbox).
2. Left sidebar → **Administration → Service accounts** → **Add service account**.
   - Name: anything, e.g. `grafana-slack-monitor`
   - Role: **Viewer** (this tool only ever reads data — it never needs write access)
3. Open the new service account → **Add service account token** → **Generate token**.
4. Copy the token immediately (starts with `glsa_...`) — Grafana only shows it once. This is your `GRAFANA_API_TOKEN`.

### 1.3 Confirm the renderer sidecar is actually reachable

```bash
curl -s -o /tmp/test.png -w "%{http_code}\n" \
  "http://localhost:3001/render/d-solo/site-a?panelId=1&width=1000&height=500&from=now-1h&to=now" \
  -H "Authorization: Bearer <your GRAFANA_API_TOKEN>"
```

Should print `200` and `/tmp/test.png` should be a real PNG (`file /tmp/test.png`). If you get a 500 with an HTML body, check `docker logs greywatch-grafana-1` and `docker logs greywatch-renderer-1` — the two most common causes, already worked around in this repo's `docker-compose.yml`, were (a) Grafana refusing a default renderer token in newer versions, and (b) the renderer image expecting `AUTH_TOKEN` as its env var name rather than the more obviously-named `RENDERING_TOKEN`. Occasional one-off timeouts on this endpoint are normal — the worker already retries on the next poll.

## 2. Slack (sandbox)

### 2.1 Create a throwaway workspace

Go to [slack.com](https://slack.com/get-started#/createnew) → **Create a new workspace**. Use a personal email; this is disposable.

### 2.2 Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. Name it anything, pick your new sandbox workspace.
3. Left sidebar → **OAuth & Permissions** → scroll to **Scopes → Bot Token Scopes** → **Add an OAuth Scope**, and add all of:
   - `chat:write` — post messages and thread replies
   - `files:write` — upload screenshots
   - `files:read` — **easy to miss.** The modern `files.uploadV2` SDK helper reads the file back after uploading it to confirm it landed, which silently requires this even though the old `files.upload` method didn't need it. Without it, screenshot uploads fail with a permissions error that doesn't obviously point at this scope.
   - `channels:read` (or `groups:read` if your test channel is private)
   - `im:write` — **required for every DM** (poll-failure notices, and breach alerts if "Also DM me" is checked). The app resolves a teammate's Slack member ID to a real DM conversation via `conversations.open` before posting or uploading to it — `chat.postMessage` alone will quietly auto-open a DM given just a user ID, but `files.uploadV2` will not, so without this scope DM screenshots fail with a confusing `invalid_arguments` on `channel_id`. Channel posts (to `L3_CHANNEL_ID`) don't need this scope at all — only DMs do.
4. Scroll up → **Install to Workspace** → **Allow**.
5. Copy the **Bot User OAuth Token** (starts with `xoxb-...`) — this is your `SLACK_BOT_TOKEN`.

### 2.3 Create test channels and invite the bot

1. In Slack, create a channel, e.g. `#l3-alerts`.
2. In that channel, type `/invite @YourAppName` — Slack requires this before a bot can post, even with `chat:write`.
3. Get the channel ID: right-click the channel name → **View channel details** → scroll to the bottom → copy the ID (looks like `C0123ABCDEF`). This is your `L3_CHANNEL_ID`.

### 2.4 Find your own Slack member ID

This app DMs the task creator directly on poll/API failures (and optionally on breach, if you check "Also DM me"), so each teammate's login needs their Slack member ID, not their username.

Click your name/profile in Slack → **···** (more) → **Copy member ID** (looks like `U0123ABCDEF`). You'll enter this at login.

## 3. `.env`

```bash
cp .env.example .env
```

Then fill in:

```bash
# Base URL of the local Grafana container (port 3001, see step 1.1)
GRAFANA_BASE_URL=http://localhost:3001
# From step 1.2 — service account token, Viewer role
GRAFANA_API_TOKEN=glsa_...

# From step 2.2 — Bot User OAuth Token
SLACK_BOT_TOKEN=xoxb-...
# From step 2.3 — the channel ID (not the channel name)
L3_CHANNEL_ID=C0123ABCDEF

# Local SQLite file — leave as-is for the sandbox
DATABASE_URL="file:./dev.db"
PORT=3000
```

## 4. Install, migrate, seed

```bash
npm install
npx prisma migrate dev
npm run db:seed        # creates the "Site A" row pointing at the site-a dashboard
```

## 5. Verify each integration on its own

```bash
npm run test:grafana   # fetches panels, queries a live value, captures a screenshot
npm run test:slack     # posts a fake breach + a fake repeat into L3_CHANNEL_ID
```

Both fail loudly with a specific error if something's misconfigured — that's intentional (see `lib/env.ts`).

## 6. Run it

You need two processes running side by side:

```bash
npm run dev      # the Next.js app — http://localhost:3000
npm run worker   # the background poller — checks due tasks every 30s
```

Open `http://localhost:3000`, log in with any username + your Slack member ID from step 2.4, create a task (e.g. Rack-to-Rack Time, `>`, threshold `15` — low enough that the sandbox data crosses it often), and leave it running.

## What "it's working" looks like

Within a few polling cycles (the sandbox data oscillates specifically so this happens fast):

- A new message appears in `#l3-alerts` in Slack: **"🚨 Threshold breached"**, with the panel screenshot attached and the current value.
- If the same task breaches again after its cooldown expires, a **reply in that same thread** appears: **"🚨 Still breached — Xm since last alert"** — not a new top-level message.
- The `/tasks` page in the app shows the task's status updating (`active` → badge shows `breached` after a check) as the worker writes to the DB.
- If you checked "Also DM me on breach," you also get a DM with the same alert.

To see the failure path: stop `docker compose` (or set `GRAFANA_BASE_URL` to something unreachable) while a task is active. Within one poll cycle you should get a DM (not a channel post) saying the tool couldn't reach Grafana — L3 never sees this, since it means the tool is broken, not that the warehouse metric is bad.

## Swapping in real GreyOrange credentials later

Once this all works on sandbox data, the only changes needed are in `.env`:
`GRAFANA_BASE_URL`/`GRAFANA_API_TOKEN` pointed at the real Grafana instance
with a real dashboard UID configured in the `Site` table, and
`SLACK_BOT_TOKEN`/`L3_CHANNEL_ID` from a real Slack app installed to the
GreyOrange workspace. No code changes should be required — if they turn out
to be, that's a sign something in this pilot assumed sandbox-specific
behavior and is worth revisiting.
