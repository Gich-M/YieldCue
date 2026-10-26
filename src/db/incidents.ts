/**
 * Incident repository.
 * Persists incidents, their state transitions, and the incident event log.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { IncidentEventKind, IncidentStatus, Severity } from '@yieldcue/contracts'
import {
  asRow,
  asRows,
  nowIso,
  toJson,
  type DbParams,
  type IncidentEventRow,
  type IncidentRow,
} from './types.ts'

export interface IncidentInput {
  workflow_id: string
  check_id: string | null
  status: IncidentStatus
  severity: Severity
  title: string
  description: string
  fingerprint: string
  opened_at: string
}

/** Mutable incident fields; updated_at and state_version are always bumped. */
export type IncidentPatch = Partial<
  Pick<
    IncidentRow,
    | 'status'
    | 'severity'
    | 'description'
    | 'acknowledged_at'
    | 'resolved_at'
    | 'last_resolved_at'
    | 'opened_at'
  >
>

export interface IncidentListFilter {
  status?: IncidentStatus | 'active'
  severity?: Severity
  workflow_id?: string
  limit?: number
}

export function getIncident(db: DatabaseSync, id: string): IncidentRow | null {
  return asRow<IncidentRow>(db.prepare('SELECT * FROM incidents WHERE id = ?').get(id))
}

export function getIncidentByFingerprint(
  db: DatabaseSync,
  fingerprint: string
): IncidentRow | null {
  return asRow<IncidentRow>(
    db.prepare('SELECT * FROM incidents WHERE fingerprint = ?').get(fingerprint)
  )
}

export function listIncidents(
  db: DatabaseSync,
  filter: IncidentListFilter = {}
): IncidentRow[] {
  const where: string[] = []
  const params: DbParams = []

  if (filter.status === 'active') {
    where.push("status IN ('open','acknowledged')")
  } else if (filter.status) {
    where.push('status = ?')
    params.push(filter.status)
  }
  if (filter.severity) {
    where.push('severity = ?')
    params.push(filter.severity)
  }
  if (filter.workflow_id) {
    where.push('workflow_id = ?')
    params.push(filter.workflow_id)
  }

  const limit = filter.limit ? Math.min(Math.max(filter.limit, 1), 500) : null
  let sql = 'SELECT * FROM incidents'
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`
  sql += ' ORDER BY opened_at DESC'
  if (limit) sql += ' LIMIT ?'

  return asRows<IncidentRow>(
    limit ? db.prepare(sql).all(...params, limit) : db.prepare(sql).all(...params)
  )
}

export function insertIncident(
  db: DatabaseSync,
  input: IncidentInput
): IncidentRow {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO incidents
      (id, workflow_id, check_id, status, severity, title, description, fingerprint,
       state_version, opened_at, acknowledged_at, resolved_at, last_resolved_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, NULL, ?)`
  ).run(
    id,
    input.workflow_id,
    input.check_id,
    input.status,
    input.severity,
    input.title,
    input.description,
    input.fingerprint,
    input.opened_at,
    ts
  )
  return getIncident(db, id)!
}

/**
 * Applies a patch to an incident, always bumping state_version and updated_at.
 * Used for both automatic and manual transitions.
 */
export function updateIncident(
  db: DatabaseSync,
  id: string,
  patch: IncidentPatch
): IncidentRow | null {
  const existing = getIncident(db, id)
  if (!existing) return null

  db.prepare(
    `UPDATE incidents SET
      status = ?, severity = ?, description = ?, acknowledged_at = ?, resolved_at = ?,
      last_resolved_at = ?, opened_at = ?, updated_at = ?, state_version = state_version + 1
     WHERE id = ?`
  ).run(
    patch.status ?? existing.status,
    patch.severity ?? existing.severity,
    patch.description ?? existing.description,
    patch.acknowledged_at !== undefined ? patch.acknowledged_at : existing.acknowledged_at,
    patch.resolved_at !== undefined ? patch.resolved_at : existing.resolved_at,
    patch.last_resolved_at !== undefined
      ? patch.last_resolved_at
      : existing.last_resolved_at,
    patch.opened_at !== undefined ? patch.opened_at : existing.opened_at,
    nowIso(),
    id
  )
  return getIncident(db, id)
}

export function appendIncidentEvent(
  db: DatabaseSync,
  incidentId: string,
  kind: IncidentEventKind,
  payload: Record<string, unknown> = {}
): void {
  db.prepare(
    `INSERT INTO incident_events (id, incident_id, kind, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(randomUUID(), incidentId, kind, toJson(payload), nowIso())
}

export function listIncidentEvents(
  db: DatabaseSync,
  incidentId: string
): IncidentEventRow[] {
  return asRows<IncidentEventRow>(
    db
      .prepare(
        'SELECT * FROM incident_events WHERE incident_id = ? ORDER BY created_at ASC'
      )
      .all(incidentId)
  )
}

export function countIncidents(db: DatabaseSync): number {
  return Number(
    asRow<{ n: number }>(db.prepare('SELECT COUNT(*) AS n FROM incidents').get())?.n ?? 0
  )
}
