/**
 * Alert-route repository.
 * SQLite persistence for alert destinations (Slack webhooks and email)
 * and their delivery filters.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Severity } from '@yieldcue/contracts'
import { asRow, asRows, fromBool, toJson, type AlertRouteRow } from './types.ts'

export type IntegrationKind = 'slack_webhook' | 'email'

export interface AlertRouteInput {
  integration_kind: IntegrationKind
  destination: unknown
  filter_workflow_id?: string | null
  filter_severity?: Severity[]
  cooldown_minutes?: number
  is_enabled?: boolean
}

export interface AlertRoutePatch {
  destination?: unknown
  filter_workflow_id?: string | null
  filter_severity?: Severity[]
  cooldown_minutes?: number
  is_enabled?: boolean
}

export function listAlertRoutes(db: DatabaseSync): AlertRouteRow[] {
  return asRows<AlertRouteRow>(
    db.prepare('SELECT * FROM alert_routes ORDER BY rowid ASC').all()
  )
}

export function getAlertRoute(db: DatabaseSync, id: string): AlertRouteRow | null {
  return asRow<AlertRouteRow>(
    db.prepare('SELECT * FROM alert_routes WHERE id = ?').get(id)
  )
}

export function createAlertRoute(
  db: DatabaseSync,
  input: AlertRouteInput
): AlertRouteRow {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO alert_routes
      (id, integration_kind, destination, filter_workflow_id, filter_severity, cooldown_minutes, is_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.integration_kind,
    toJson(input.destination),
    input.filter_workflow_id ?? null,
    JSON.stringify(input.filter_severity ?? []),
    input.cooldown_minutes ?? 0,
    fromBool(input.is_enabled ?? true)
  )
  return getAlertRoute(db, id)!
}

export function updateAlertRoute(
  db: DatabaseSync,
  id: string,
  patch: AlertRoutePatch
): AlertRouteRow | null {
  const existing = getAlertRoute(db, id)
  if (!existing) return null

  db.prepare(
    `UPDATE alert_routes SET
      destination = ?, filter_workflow_id = ?, filter_severity = ?, cooldown_minutes = ?, is_enabled = ?
     WHERE id = ?`
  ).run(
    patch.destination !== undefined ? toJson(patch.destination) : existing.destination,
    patch.filter_workflow_id !== undefined
      ? patch.filter_workflow_id
      : existing.filter_workflow_id,
    patch.filter_severity !== undefined
      ? JSON.stringify(patch.filter_severity)
      : existing.filter_severity,
    patch.cooldown_minutes ?? existing.cooldown_minutes,
    patch.is_enabled !== undefined ? fromBool(patch.is_enabled) : existing.is_enabled,
    id
  )
  return getAlertRoute(db, id)
}

export function deleteAlertRoute(db: DatabaseSync, id: string): boolean {
  const result = db.prepare('DELETE FROM alert_routes WHERE id = ?').run(id)
  return result.changes > 0
}

export function countAlertRoutes(db: DatabaseSync): number {
  return Number(
    asRow<{ n: number }>(db.prepare('SELECT COUNT(*) AS n FROM alert_routes').get())?.n ??
      0
  )
}
