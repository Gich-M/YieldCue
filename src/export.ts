/**
 * Full data export (§8.7) and Prepare-for-Cloud setup bundle (§8.7, §8.11).
 * Both exclude notification credentials and secret values.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Context } from 'hono'
import type { SelfHostedSetupBundle } from '@yieldcue/contracts'
import {
  asRows,
  parseJson,
  toBool,
  type CheckRow,
  type EventRow,
  type IncidentRow,
  type WorkflowRow,
} from './db/types.ts'
import { listWorkflows } from './db/workflows.ts'
import { listIncidents } from './db/incidents.ts'
import { countAlertRoutes } from './db/alert-routes.ts'
import { countEvents } from './db/events.ts'
import { countIncidents } from './db/incidents.ts'

function exportWorkflow(row: WorkflowRow) {
  return {
    id: row.id,
    name: row.name,
    workflow_key: row.workflow_key,
    description: row.description,
    metadata: parseJson(row.metadata),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function exportCheck(row: CheckRow) {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    check_type: row.check_type,
    name: row.name,
    config: parseJson(row.config),
    severity: row.severity,
    is_enabled: toBool(row.is_enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function exportEvent(row: EventRow) {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    event_type: row.event_type,
    payload: parseJson(row.payload),
    idempotency_key: row.idempotency_key,
    received_at: row.received_at,
    is_test: toBool(row.is_test),
  }
}

function exportIncident(row: IncidentRow) {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    check_id: row.check_id,
    status: row.status,
    severity: row.severity,
    title: row.title,
    description: row.description,
    fingerprint: row.fingerprint,
    state_version: row.state_version,
    opened_at: row.opened_at,
    acknowledged_at: row.acknowledged_at,
    resolved_at: row.resolved_at,
    last_resolved_at: row.last_resolved_at,
    updated_at: row.updated_at,
  }
}

export function buildExport(db: DatabaseSync) {
  const checks = asRows<CheckRow>(db.prepare('SELECT * FROM checks').all())
  const events = asRows<EventRow>(
    db.prepare('SELECT * FROM events ORDER BY received_at ASC').all()
  )
  return {
    export_version: 1,
    exported_at: new Date().toISOString(),
    workflows: listWorkflows(db).map(exportWorkflow),
    checks: checks.map(exportCheck),
    events: events.map(exportEvent),
    incidents: listIncidents(db).map(exportIncident),
  }
}

export function buildSetupBundle(db: DatabaseSync): SelfHostedSetupBundle {
  const workflows = listWorkflows(db).map((row) => {
    const metadata = parseJson<Record<string, unknown>>(row.metadata)
    const setupMetadata: Record<string, string> = {}
    if (typeof metadata.provider === 'string') setupMetadata.provider = metadata.provider
    if (typeof metadata.environment === 'string') {
      setupMetadata.environment = metadata.environment
    }

    return {
      id: row.id,
      workflow_key: row.workflow_key,
      name: row.name,
      description: row.description || undefined,
      status: row.status,
      ...(Object.keys(setupMetadata).length > 0 ? { metadata: setupMetadata } : {}),
    }
  })

  const checks = asRows<CheckRow>(db.prepare('SELECT * FROM checks').all()).map((row) => ({
    id: row.id,
    workflow_id: row.workflow_id,
    check_type: row.check_type,
    name: row.name,
    config: parseJson(row.config),
    severity: row.severity,
    is_enabled: toBool(row.is_enabled),
  })) as unknown as SelfHostedSetupBundle['checks']

  return {
    format: 'yieldcue-self-hosted-setup',
    setup_version: 1,
    bundle_id: randomUUID(),
    created_at: new Date().toISOString(),
    workflows,
    checks,
    omitted: {
      events: countEvents(db),
      incidents: countIncidents(db),
      alert_destinations: countAlertRoutes(db),
    },
  }
}

export function handleExport(c: Context, db: DatabaseSync): Response {
  c.header('Content-Disposition', 'attachment; filename="yieldcue-export.json"')
  return c.json(buildExport(db))
}

export function handlePrepareForCloud(c: Context, db: DatabaseSync): Response {
  const bundle = buildSetupBundle(db)
  c.header(
    'Content-Disposition',
    `attachment; filename="yieldcue-setup-${bundle.bundle_id}.json"`
  )
  return c.json(bundle)
}
