-- YieldCue self-hosted schema v1 (§8.4 of docs/opensource/opensource.md).
-- Single operator, single database file. No tenant/client/actor columns.

PRAGMA foreign_keys = ON;

CREATE TABLE workflows (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  workflow_key  TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  metadata      TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'disabled')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE checks (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  check_type  TEXT NOT NULL,
  name        TEXT NOT NULL,
  config      TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'warning'
              CHECK (severity IN ('critical', 'warning', 'info')),
  is_enabled  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_checks_workflow ON checks(workflow_id);

CREATE TABLE events (
  id               TEXT PRIMARY KEY,
  workflow_id      TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL CHECK (event_type IN ('heartbeat', 'signal')),
  payload          TEXT NOT NULL,
  idempotency_key  TEXT,
  received_at      TEXT NOT NULL,
  is_test          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workflow_id, idempotency_key)
);
CREATE INDEX idx_events_workflow_received ON events(workflow_id, received_at);

CREATE TABLE incidents (
  id               TEXT PRIMARY KEY,
  workflow_id      TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  check_id         TEXT REFERENCES checks(id) ON DELETE SET NULL,
  status           TEXT NOT NULL
                   CHECK (status IN ('open', 'acknowledged', 'resolved', 'ignored')),
  severity         TEXT NOT NULL
                   CHECK (severity IN ('critical', 'warning', 'info')),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  fingerprint      TEXT NOT NULL UNIQUE,
  state_version    INTEGER NOT NULL DEFAULT 1,
  opened_at        TEXT NOT NULL,
  acknowledged_at  TEXT,
  resolved_at      TEXT,
  last_resolved_at TEXT,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_incidents_workflow ON incidents(workflow_id);
CREATE INDEX idx_incidents_status ON incidents(status);

CREATE TABLE incident_events (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_incident_events_incident ON incident_events(incident_id, created_at);

CREATE TABLE alert_routes (
  id                 TEXT PRIMARY KEY,
  integration_kind   TEXT NOT NULL CHECK (integration_kind IN ('slack_webhook', 'email')),
  destination        TEXT NOT NULL,
  filter_workflow_id TEXT,
  filter_severity    TEXT NOT NULL DEFAULT '[]',
  cooldown_minutes   INTEGER NOT NULL DEFAULT 0,
  is_enabled         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE alert_deliveries (
  id             TEXT PRIMARY KEY,
  incident_id    TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  alert_route_id TEXT NOT NULL REFERENCES alert_routes(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL,
  status         TEXT NOT NULL
                 CHECK (status IN ('pending', 'delivered', 'failed')),
  state_version  INTEGER NOT NULL,
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  next_retry_at  TEXT,
  sent_at        TEXT,
  UNIQUE (alert_route_id, incident_id, state_version)
);
CREATE INDEX idx_alert_deliveries_pending ON alert_deliveries(status, next_retry_at);
-- Most recent delivered row per route + incident, for the cooldown check.
CREATE INDEX idx_alert_deliveries_lookup ON alert_deliveries(alert_route_id, incident_id, sent_at);

CREATE TABLE check_state (
  id                   TEXT PRIMARY KEY,
  check_id             TEXT NOT NULL UNIQUE REFERENCES checks(id) ON DELETE CASCADE,
  last_event_id        TEXT,
  last_evaluated_at    TEXT,
  next_expected_at     TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  baseline_value       REAL,
  state_data           TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
