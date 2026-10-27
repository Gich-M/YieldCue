/**
 * Event repository.
 * Append-only telemetry ledger with idempotency and heartbeat lookups.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { EventType } from '@yieldcue/contracts'
import { asRow, asRows, fromBool, toJson, type DbParams, type EventRow } from './types.ts'

export interface EventInput {
  id: string
  workflow_id: string
  event_type: EventType
  payload: unknown
  idempotency_key: string | null
  received_at: string
  is_test: boolean
}

export function insertEvent(db: DatabaseSync, input: EventInput): void {
  db.prepare(
    `INSERT INTO events (id, workflow_id, event_type, payload, idempotency_key, received_at, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.workflow_id,
    input.event_type,
    toJson(input.payload),
    input.idempotency_key,
    input.received_at,
    fromBool(input.is_test)
  )
}

export function getEvent(db: DatabaseSync, id: string): EventRow | null {
  return asRow<EventRow>(db.prepare('SELECT * FROM events WHERE id = ?').get(id))
}

export function getEventByWorkflowAndKey(
  db: DatabaseSync,
  workflowId: string,
  idempotencyKey: string
): EventRow | null {
  return asRow<EventRow>(
    db
      .prepare('SELECT * FROM events WHERE workflow_id = ? AND idempotency_key = ?')
      .get(workflowId, idempotencyKey)
  )
}

export interface WorkflowEventsFilter {
  since?: string
  limit?: number
}

export function listWorkflowEvents(
  db: DatabaseSync,
  workflowId: string,
  filter: WorkflowEventsFilter = {}
): EventRow[] {
  const where: string[] = ['workflow_id = ?']
  const params: DbParams = [workflowId]
  if (filter.since) {
    where.push('received_at >= ?')
    params.push(filter.since)
  }
  let sql = `SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY received_at ASC`
  if (filter.limit) {
    sql += ' LIMIT ?'
    params.push(filter.limit)
  }
  return asRows<EventRow>(db.prepare(sql).all(...params))
}

export function listRecentEvents(db: DatabaseSync, limit: number): EventRow[] {
  return asRows<EventRow>(
    db.prepare('SELECT * FROM events ORDER BY received_at DESC LIMIT ?').all(limit)
  )
}

/** Latest heartbeat receipt time for a workflow, or null if none has arrived. */
export function getLastHeartbeatAt(
  db: DatabaseSync,
  workflowId: string
): string | null {
  const row = db
    .prepare(
      `SELECT received_at FROM events
       WHERE workflow_id = ? AND event_type = 'heartbeat'
       ORDER BY received_at DESC LIMIT 1`
    )
    .get(workflowId)
  return asRow<{ received_at: string }>(row)?.received_at ?? null
}

export function countEvents(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM events').get()
  return Number(asRow<{ n: number }>(row)?.n ?? 0)
}
