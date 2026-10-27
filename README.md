<p align="center">
  <a href="https://yieldcue.com"><img alt="YieldCue" src="assets/logo.png" width="120"></a>
</p>

<h1 align="center">Know when a workflow runs but doesn't deliver.</h1>

<div align="center">
  <strong>
    <a href="https://yieldcue.com/">YieldCue</a> is open-source outcome monitoring for business workflows.
    It catches the "green but wrong" failures that execution monitoring misses: a job reports success, but the business gets no result.
  </strong>
</div>

<p align="center">
  <strong>One container · One SQLite file · No telemetry</strong>
</p>

<p align="center">
  <br />
  <a href="#quick-start"><strong>Self-host YieldCue »</strong></a>
  <br />
</p>

<p align="center">
  <a href="https://yieldcue.com/">YieldCue Cloud</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="https://github.com/Gich-M/YieldCue/discussions">Discussions</a>
  ·
  <a href="#contributing">Contribute</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg" alt="License: AGPL-3.0-or-later"></a>
</p>

<br />

<p align="center"><strong>Works with:</strong></p>
<div align="center">
  <a href="https://app.n8n.cloud/" title="n8n"><img alt="n8n" src="https://cdn.simpleicons.org/n8n" width="32"></a>&nbsp;&nbsp;
  <a href="https://www.make.com/en/login" title="Make"><img alt="Make" src="https://cdn.simpleicons.org/make" width="32"></a>&nbsp;&nbsp;
  <a href="https://zapier.com/app/login" title="Zapier"><img alt="Zapier" src="https://cdn.simpleicons.org/zapier" width="32"></a>&nbsp;&nbsp;
  <a href="https://app.hubspot.com/login" title="HubSpot"><img alt="HubSpot" src="https://cdn.simpleicons.org/hubspot" width="32"></a>
</div>

<br />

## Why YieldCue?

Execution monitoring tells you whether a workflow ran. YieldCue checks whether it produced the outcome you expected, then gives your team an incident to act on.

| Check | Example |
|---|---|
| **Presence** | A heartbeat is missing, or a run produced zero output. |
| **Volume** | A report contains fewer records than expected, or activity drops below its baseline. |
| **Correctness** | A status or value does not match the result you expect. |
| **Freshness** | The data behind a successful run is out of date. |

Define explicit checks for your workflows. YieldCue evaluates incoming events, groups matching failures into incidents, and routes alerts to Slack or email. Each incident points to the check that failed.

## Features

- **Eleven check types** across presence, volume, correctness, and freshness.
- **Actionable incidents** with evidence and an open, acknowledge, resolve, ignore, and reopen lifecycle. Matching failures are deduplicated.
- **Slack and email alerts** with bounded retries and per-route cooldowns.
- **Self-hosted by default** with one SQLite database, WAL mode, and automatic migrations.
- **No telemetry**. The client makes no outbound requests except to alert destinations you configure.
- **Simple interface** built with server-rendered HTML and HTMX; no frontend build step.

## Tech Stack

- **Hono** — HTTP framework; one ingest endpoint plus server-rendered UI.
- **HTMX** — client-side interactivity with no frontend build step.
- **node:sqlite** — embedded SQLite with WAL mode and automatic migrations.
- **TypeScript** — run directly via `tsx`; no compilation step.
- **Docker** — one container, one volume.

## Cloud vs. Open-source

Choose [YieldCue Cloud](https://yieldcue.com/) for a managed experience, or deploy this open-source edition on your own infrastructure.

| Area | YieldCue Cloud | Self-hosted (this repo) |
|---|---|---|
| **Cost** | Subscription | Free forever (AGPL-3.0-or-later); you pay only your own infra |
| **Setup** | Sign up and add workflows in minutes | One Docker container and one SQLite file |
| **Hosting & data** | Hosted by YieldCue | Runs on your server; data never leaves your environment |
| **Workflows, checks, incidents** | Managed | Unlimited, bounded only by disk |
| **Team members** | Per plan | Single `operator` user |
| **Retention** | Managed | You configure; defaults 90d events, 1y incidents, 180d deliveries |
| **Updates & maintenance** | Automatic | You pull new images and run migrations yourself |
| **Backups** | Managed | Your responsibility (copy the data directory) |
| **Support** | Per plan | Community (GitHub Discussions) |
| **Source access** | No (SaaS) | Full source; fork and modify under AGPL |
| **Data residency** | YieldCue-managed regions | Any region or air-gapped environment |

This repository is for operators who want to run YieldCue themselves.

## Quick start

### 1. Run the container

Generate the two tokens and save them somewhere safe before starting the container - they are your sign-in credentials.

```bash
export YIELDCUE_AUTH_TOKEN="$(openssl rand -hex 32)"
export YIELDCUE_INGEST_TOKEN="$(openssl rand -hex 32)"

docker build -t yieldcue .

docker run -d --name yieldcue \
  -p 8080:8080 \
  -v yieldcue-data:/data \
  -e YIELDCUE_AUTH_TOKEN="$YIELDCUE_AUTH_TOKEN" \
  -e YIELDCUE_INGEST_TOKEN="$YIELDCUE_INGEST_TOKEN" \
  yieldcue
```

`YIELDCUE_AUTH_TOKEN` and `YIELDCUE_INGEST_TOKEN` must each be at least 32 bytes and must differ. The client refuses to start serving otherwise.

### 2. Create a workflow

Open `http://localhost:8080` and sign in with username `operator` and the value of `YIELDCUE_AUTH_TOKEN` as the password. If you exported the tokens in step 1, print the password with `echo "$YIELDCUE_AUTH_TOKEN"`. If you started the container without saving it, retrieve it with `docker exec yieldcue printenv YIELDCUE_AUTH_TOKEN`. Create a workflow and note its `workflow_key`.

### 3. Send your first event

```bash
curl -X POST http://localhost:8080/v1/ingest/events \
  -H "Authorization: Bearer $YIELDCUE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ingest_version": 1,
    "event_type": "heartbeat",
    "workflow_key": "daily-report",
    "occurred_at": "2026-10-26T08:00:00Z",
    "context": { "run_id": "run-123" }
  }'
```

The response is `202 Accepted`. Attach a heartbeat check to the workflow and YieldCue will raise an incident when the next heartbeat does not arrive on time.

## Sending events

Events are posted to `POST /v1/ingest/events` with `Authorization: Bearer $YIELDCUE_INGEST_TOKEN`. The ingest token grants event ingest only - it cannot read the UI, change configuration, or run exports.

| Field | Type | Notes |
|---|---|---|
| `ingest_version` | number | Must be `1`. |
| `event_type` | string | `heartbeat` or `signal`. |
| `workflow_key` | string | The key you set on the workflow. At most 128 bytes. |
| `occurred_at` | string | ISO-8601 timestamp. |
| `status` | string | `ok`, `warn`, or `error`. Required for `signal`. |
| `metrics` | object | Map of numeric metrics, at most 16 keys. |
| `context` | object | Arbitrary structured data, at most 3 levels deep. |
| `idempotency_key` | string | Required for `signal`. At most 128 bytes. |
| `is_test` | boolean | Defaults to `false`. Test events are not evaluated. |
| `client_key` | string | Optional, at most 128 bytes. |
| `provider_run_id` | string | Optional. |

The request body is limited to 16 KB. Excess context depth and metric keys are compacted rather than rejected, and the response reports `meta.truncated: true`.

A `signal` event with a metric and a status looks like this:

```bash
curl -X POST http://localhost:8080/v1/ingest/events \
  -H "Authorization: Bearer $YIELDCUE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ingest_version": 1,
    "event_type": "signal",
    "workflow_key": "daily-report",
    "occurred_at": "2026-10-26T08:00:00Z",
    "status": "ok",
    "idempotency_key": "run-123",
    "metrics": { "rows_processed": 128 },
    "context": { "report_id": "r-456" }
  }'
```

Idempotency: retrying an identical request returns `202` with `duplicate: true` and the original `event_id`. Reusing an `idempotency_key` with different fields returns `409` (`idempotency_conflict`).

## Supported providers

YieldCue is provider-agnostic: any tool that can make an HTTP request can send an event. The same payload shape is used everywhere.

### n8n

Add an **HTTP Request** node pointing at the ingest URL, with an `Authorization` header set to `Bearer $YIELDCUE_INGEST_TOKEN`, and send the same JSON body shown above.

### Make

Use the **HTTP** module's "Make a request" action. Set the URL and headers, then paste the JSON body into the request content.

### Zapier

Use **Webhooks by Zapier** with a POST action to the ingest URL, adding the `Authorization` header and the JSON body.

### HubSpot

Use an **Operations Hub** workflow with a **Send a webhook** action. Set the method to POST, point it at the ingest URL, add an `Authorization` header set to `Bearer $YIELDCUE_INGEST_TOKEN`, and paste the JSON body into the request content. Requires an Operations Hub Professional or Enterprise plan, with custom headers enabled on the webhook action.

### Airtable (via an automation tool)

Airtable has no native outbound webhook. Use a Zapier, Make, or n8n Airtable trigger and send the event from that automation provider, or use an Airtable **Run a script** automation that calls `fetch()` if you own and maintain that script. The payload shape is the same either way.

### Cron or any shell script

```bash
curl -fsS -X POST http://localhost:8080/v1/ingest/events \
  -H "Authorization: Bearer $YIELDCUE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ingest_version": 1,
    "event_type": "signal",
    "workflow_key": "daily-report",
    "occurred_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
    "status": "ok",
    "idempotency_key": "'"$(date -u +%Y-%m-%d)"'",
    "context": {}
  }'
```

## Alert destinations

Configure destinations in **Settings**. Two integrations are supported:

- **Slack** - a Slack incoming webhook URL.
- **Email** - SMTP server credentials.

Delivery is at-least-once: a provider timeout or a crash after the provider accepts a notification can produce a duplicate. Retryable failures (network errors, timeouts, `429`, and `5xx`) are retried up to a total of 12 attempts; other `4xx` responses are terminal.

## Environment variables

| Variable | Required | Default | Description |
|---|---:|---|---|
| `YIELDCUE_AUTH_TOKEN` | yes | - | UI password for the `operator` user. At least 32 bytes. |
| `YIELDCUE_INGEST_TOKEN` | yes | - | Ingest bearer token. At least 32 bytes; must differ from `YIELDCUE_AUTH_TOKEN`. |
| `YIELDCUE_PORT` | no | `8080` | HTTP listen port. |
| `YIELDCUE_BIND` | no | `127.0.0.1` | Listen address. |
| `YIELDCUE_DATA_DIR` | no | `/data` | Directory holding the `yieldcue.sqlite` database. |

There is no configuration file. Alert destinations, cooldowns, and retention take effect without a restart.

Browser sessions are stateless signed cookies that last 14 days. Rotating `YIELDCUE_AUTH_TOKEN` invalidates every active session immediately - the token both signs the session cookie and serves as the sign-in password, so a rotation is also a forced sign-out on all devices.

## The interface

The UI is server-rendered HTML with HTMX. It has five screens:

- **Workflows** - list and manage workflows.
- **Workflow detail** - edit a workflow and its checks.
- **Incidents** - list open and resolved incidents.
- **Incident detail** - view history, acknowledge, resolve, ignore, or reopen.
- **Settings** - alert destinations, export, and Prepare for Cloud.

## Data and retention

The client stores everything in a single SQLite database file (`yieldcue.sqlite`) in the data directory. Automatic retention removes:

- events after 90 days,
- incidents and incident history after 1 year,
- terminal alert deliveries after 180 days.

### Backup and restore

Stop the container, copy the entire data directory, then restart:

```bash
docker stop yieldcue
docker cp yieldcue:/data ./yieldcue-backup
docker start yieldcue
```

To restore, stop the container, replace the data directory with the backup, and start it again. Migrations run automatically on boot.

## Export and cloud migration

`GET /export` (behind the UI login) returns a full JSON snapshot - workflows, checks, events, and incidents. It omits notification credentials and secret values. The snapshot is data portability, not a backup and not a cloud migration file.

To migrate configuration to YieldCue Cloud, use **Settings → Prepare for Cloud**. This downloads a versioned setup bundle containing workflows and checks only - no event history, incidents, alert destinations, or credentials. Review the bundle before uploading it, and re-verify that alerts work in the cloud after import.

## Security

- **No telemetry.** The client makes no outbound requests except to your configured alert destinations. There are no analytics, no hidden endpoints, and no phone-home.
- **TLS is your responsibility.** The client does not terminate TLS. The default bind (`127.0.0.1`) exposes nothing to the network. A non-loopback `YIELDCUE_BIND` is an explicit opt-in; set it only behind a TLS-terminating reverse proxy.
- **Credential storage.** Notification credentials are stored unencrypted in the local SQLite database and its backups; restrict access to both.

To report a security vulnerability, see [SECURITY.md](./SECURITY.md). Do not open a public issue.

## Compliance

- This repository is the open-source, self-hosted edition of YieldCue. [YieldCue Cloud](https://yieldcue.com/) is a separate managed service.
- YieldCue is provider-agnostic: it only receives events you send to `POST /v1/ingest/events`; it never connects to, scrapes, or automates a third-party workflow provider.

## Community

Questions, ideas, or examples of workflows you monitor with YieldCue? [Join the GitHub Discussions](https://github.com/Gich-M/YieldCue/discussions). For reproducible bugs, open an issue in the repository.

## License

The self-hosted client is licensed under **AGPL-3.0-or-later** (see [LICENSE](./LICENSE)). The vendored shared packages - `@yieldcue/contracts`, `@yieldcue/domain`, and `@yieldcue/notifications` - are licensed under **MIT** (see [vendor/LICENSE](./vendor/LICENSE)). The HTMX runtime vendored at `public/htmx.min.js` is licensed under the Zero-Clause BSD license (see [vendor/LICENSE-htmx](./vendor/LICENSE-htmx)).

## Contributing

Contributions are welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md). Bug fixes and README corrections are a good place to start. For new ideas or check types, [start a discussion](https://github.com/Gich-M/YieldCue/discussions) before opening a pull request.
