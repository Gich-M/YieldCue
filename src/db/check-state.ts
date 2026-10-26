/**
 * Check-state repository.
 * Persists per-check evaluator state: last seen event, next expected
 * heartbeat, consecutive failures, baseline, and opaque state data.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { asRow, nowIso, toJson, type CheckStateRow } from './types.ts'

export interface CheckStateInput {
  check_id: string
  last_event_id?: string | null
  last_evaluated_at?: string | null
  next_expected_at?: string | null
  consecutive_failures?: number
  baseline_value?: number | null
  state_data?: Record<string, unknown>
}

export function getCheckState(
  db: DatabaseSync,
  checkId: string
): CheckStateRow | null {
  return asRow<CheckStateRow>(
    db.prepare('SELECT * FROM check_state WHERE check_id = ?').get(checkId)
  )
}

/** Inserts or merges a check-state row. Missing fields on update keep prior values. */
export function upsertCheckState(db: DatabaseSync, input: CheckStateInput): void {
  const existing = getCheckState(db, input.check_id)

  if (!existing) {
    db.prepare(
      `INSERT INTO check_state
        (id, check_id, last_event_id, last_evaluated_at, next_expected_at, consecutive_failures, baseline_value, state_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      input.check_id,
      input.last_event_id ?? null,
      input.last_evaluated_at ?? nowIso(),
      input.next_expected_at ?? null,
      input.consecutive_failures ?? 0,
      input.baseline_value ?? null,
      toJson(input.state_data ?? {})
    )
    return
  }

  const stateData =
    input.state_data !== undefined
      ? { ...JSON.parse(existing.state_data), ...input.state_data }
      : JSON.parse(existing.state_data)

  db.prepare(
    `UPDATE check_state SET
      last_event_id = ?, last_evaluated_at = ?, next_expected_at = ?,
      consecutive_failures = ?, baseline_value = ?, state_data = ?
     WHERE check_id = ?`
  ).run(
    input.last_event_id !== undefined ? input.last_event_id : existing.last_event_id,
    input.last_evaluated_at ?? existing.last_evaluated_at,
    input.next_expected_at !== undefined ? input.next_expected_at : existing.next_expected_at,
    input.consecutive_failures ?? existing.consecutive_failures,
    input.baseline_value !== undefined ? input.baseline_value : existing.baseline_value,
    toJson(stateData),
    input.check_id
  )
}
