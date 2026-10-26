/**
 * Alert-delivery outbox repository.
 * Persists alert delivery attempts and exposes the pending queue and
 * cooldown lookups used by the delivery worker.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { asRow, asRows, type AlertDeliveryRow } from './types.ts'

export interface DeliveryInput {
  incident_id: string
  alert_route_id: string
  channel: string
  status: AlertDeliveryRow['status']
  state_version: number
  attempt_count: number
  next_retry_at: string | null
  sent_at: string | null
}

export function insertDelivery(db: DatabaseSync, input: DeliveryInput): void {
  db.prepare(
    `INSERT INTO alert_deliveries
      (id, incident_id, alert_route_id, channel, status, state_version, attempt_count, next_retry_at, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    input.incident_id,
    input.alert_route_id,
    input.channel,
    input.status,
    input.state_version,
    input.attempt_count,
    input.next_retry_at,
    input.sent_at
  )
}

export function getDelivery(db: DatabaseSync, id: string): AlertDeliveryRow | null {
  return asRow<AlertDeliveryRow>(
    db.prepare('SELECT * FROM alert_deliveries WHERE id = ?').get(id)
  )
}

export function listDuePendingDeliveries(
  db: DatabaseSync,
  now: string
): AlertDeliveryRow[] {
  return asRows<AlertDeliveryRow>(
    db
      .prepare(
        `SELECT * FROM alert_deliveries
         WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
         ORDER BY rowid ASC`
      )
      .all(now)
  )
}

export function updateDelivery(
  db: DatabaseSync,
  id: string,
  patch: Partial<Pick<AlertDeliveryRow, 'status' | 'attempt_count' | 'next_retry_at' | 'sent_at'>>
): void {
  const existing = getDelivery(db, id)
  if (!existing) return

  db.prepare(
    `UPDATE alert_deliveries SET status = ?, attempt_count = ?, next_retry_at = ?, sent_at = ?
     WHERE id = ?`
  ).run(
    patch.status ?? existing.status,
    patch.attempt_count ?? existing.attempt_count,
    patch.next_retry_at !== undefined ? patch.next_retry_at : existing.next_retry_at,
    patch.sent_at !== undefined ? patch.sent_at : existing.sent_at,
    id
  )
}

/** Most recent delivered row for a route + incident, for cooldown checks. */
export function getLatestDeliveredAt(
  db: DatabaseSync,
  alertRouteId: string,
  incidentId: string
): string | null {
  const row = db
    .prepare(
      `SELECT sent_at FROM alert_deliveries
       WHERE alert_route_id = ? AND incident_id = ? AND status = 'delivered'
       ORDER BY sent_at DESC LIMIT 1`
    )
    .get(alertRouteId, incidentId)
  return asRow<{ sent_at: string }>(row)?.sent_at ?? null
}

export function countDeliveries(db: DatabaseSync): number {
  return Number(
    asRow<{ n: number }>(db.prepare('SELECT COUNT(*) AS n FROM alert_deliveries').get())
      ?.n ?? 0
  )
}
