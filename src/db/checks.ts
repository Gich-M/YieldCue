/**
 * Check repository.
 * SQLite persistence for workflow checks and their configuration.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CheckType, Severity } from '@yieldcue/contracts'
import { asRow, asRows, fromBool, nowIso, toJson, type CheckRow } from './types.ts'

export interface CheckInput {
  workflow_id: string
  check_type: CheckType
  name: string
  config: unknown
  severity?: Severity
  is_enabled?: boolean
}

export interface CheckPatch {
  name?: string
  config?: unknown
  severity?: Severity
  is_enabled?: boolean
}

export function listChecks(db: DatabaseSync, workflowId: string): CheckRow[] {
  return asRows<CheckRow>(
    db
      .prepare('SELECT * FROM checks WHERE workflow_id = ? ORDER BY created_at ASC')
      .all(workflowId)
  )
}

export function getCheck(db: DatabaseSync, id: string): CheckRow | null {
  return asRow<CheckRow>(db.prepare('SELECT * FROM checks WHERE id = ?').get(id))
}

export function createCheck(db: DatabaseSync, input: CheckInput): CheckRow {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO checks (id, workflow_id, check_type, name, config, severity, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.workflow_id,
    input.check_type,
    input.name,
    toJson(input.config),
    input.severity ?? 'warning',
    fromBool(input.is_enabled ?? true),
    ts,
    ts
  )
  return getCheck(db, id)!
}

export function updateCheck(
  db: DatabaseSync,
  id: string,
  patch: CheckPatch
): CheckRow | null {
  const existing = getCheck(db, id)
  if (!existing) return null

  db.prepare(
    `UPDATE checks SET name = ?, config = ?, severity = ?, is_enabled = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.name ?? existing.name,
    patch.config !== undefined ? toJson(patch.config) : existing.config,
    patch.severity ?? existing.severity,
    patch.is_enabled !== undefined ? fromBool(patch.is_enabled) : existing.is_enabled,
    nowIso(),
    id
  )
  return getCheck(db, id)
}

export function deleteCheck(db: DatabaseSync, id: string): boolean {
  const result = db.prepare('DELETE FROM checks WHERE id = ?').run(id)
  return result.changes > 0
}
