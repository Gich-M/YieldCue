/**
 * Workflow repository.
 * SQLite persistence for workflows, including the tenant-less mapping to
 * the shared contract shape.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Workflow } from '@yieldcue/contracts'
import { asRow, asRows, nowIso, parseJson, toJson, type WorkflowRow } from './types.ts'

export interface WorkflowInput {
  name: string
  workflow_key: string
  description?: string
  metadata?: Record<string, unknown>
  status?: Workflow['status']
}

export interface WorkflowListRow extends WorkflowRow {
  check_count: number
  open_incident_count: number
}

export function listWorkflows(db: DatabaseSync): WorkflowListRow[] {
  return asRows<WorkflowListRow>(
    db
      .prepare(
        `SELECT w.*,
          (SELECT COUNT(*) FROM checks c WHERE c.workflow_id = w.id) AS check_count,
          (SELECT COUNT(*) FROM incidents i
            WHERE i.workflow_id = w.id AND i.status IN ('open','acknowledged')) AS open_incident_count
         FROM workflows w
         ORDER BY w.created_at DESC`
      )
      .all()
  )
}

export function getWorkflow(db: DatabaseSync, id: string): WorkflowRow | null {
  return asRow<WorkflowRow>(db.prepare('SELECT * FROM workflows WHERE id = ?').get(id))
}

export function getWorkflowByKey(
  db: DatabaseSync,
  workflow_key: string
): WorkflowRow | null {
  return asRow<WorkflowRow>(
    db.prepare('SELECT * FROM workflows WHERE workflow_key = ?').get(workflow_key)
  )
}

export function createWorkflow(
  db: DatabaseSync,
  input: WorkflowInput
): WorkflowRow {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO workflows (id, name, workflow_key, description, metadata, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.workflow_key,
    input.description ?? '',
    toJson(input.metadata ?? {}),
    input.status ?? 'active',
    ts,
    ts
  )
  return getWorkflow(db, id)!
}

export function updateWorkflow(
  db: DatabaseSync,
  id: string,
  patch: Partial<WorkflowInput>
): WorkflowRow | null {
  const existing = getWorkflow(db, id)
  if (!existing) return null

  db.prepare(
    `UPDATE workflows SET
      name = ?, workflow_key = ?, description = ?, metadata = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.name ?? existing.name,
    patch.workflow_key ?? existing.workflow_key,
    patch.description ?? existing.description,
    patch.metadata !== undefined ? toJson(patch.metadata) : existing.metadata,
    patch.status ?? existing.status,
    nowIso(),
    id
  )
  return getWorkflow(db, id)
}

export function deleteWorkflow(db: DatabaseSync, id: string): boolean {
  const result = db.prepare('DELETE FROM workflows WHERE id = ?').run(id)
  return result.changes > 0
}

export function workflowToContract(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    tenant_id: 'self-hosted',
    client_id: null,
    name: row.name,
    workflow_key: row.workflow_key,
    description: row.description,
    status: row.status,
    metadata: parseJson(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
