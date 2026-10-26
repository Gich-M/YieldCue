/**
 * Event repository.
 * Append-only telemetry ledger with idempotency and heartbeat lookups.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { EventType } from '@yieldcue/contracts'
import { asRow, asRows, fromBool, toJson, type EventRow } from './types.ts'

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

export function listWorkflowEvents(
  db: DatabaseSync,
  workflowId: string,
  limit?: number
): EventRow[] {
  const sql = limit
    ? 'SELECT * FROM events WHERE workflow_id = ? ORDER BY received_at ASC LIMIT ?'
    : 'SELECT * FROM events WHERE workflow_id = ? ORDER BY received_at ASC'
  return asRows<EventRow>(
    limit ? db.prepare(sql).all(workflowId, limit) : db.prepare(sql).all(workflowId)
  )
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
