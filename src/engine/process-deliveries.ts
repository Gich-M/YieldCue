/**
 * Alert delivery outbox processor (§8.3). Attempts each due pending delivery;
 * applies the bounded-retry policy and records terminal state.
 */

import type { DatabaseSync } from 'node:sqlite'
import { getIncident } from '../db/incidents.ts'
import { getWorkflow } from '../db/workflows.ts'
import { getAlertRoute } from '../db/alert-routes.ts'
import { listDuePendingDeliveries, updateDelivery } from '../db/deliveries.ts'
import { sendDelivery } from './deliver.ts'

const MAX_ATTEMPTS = 12
const RETRY_DELAY_MS = 60_000

// The scheduler tick and the ingest handler both call this, and without a
// shared lock a mid-run delivery can be re-listed and sent twice. The flag is
// checked and set synchronously, so Node's single thread makes it atomic.
let processing = false

/** Attempts all due deliveries. Returns the number processed. */
export async function processDueDeliveries(db: DatabaseSync): Promise<number> {
  if (processing) return 0
  processing = true
  try {
    const now = new Date().toISOString()
    const due = listDuePendingDeliveries(db, now)
    let processed = 0

    for (const delivery of due) {
      processed++
      const incident = getIncident(db, delivery.incident_id)
      const route = getAlertRoute(db, delivery.alert_route_id)
      if (!incident || !route) continue

      const workflow = incident.workflow_id ? getWorkflow(db, incident.workflow_id) : null
      const nextAttempt = delivery.attempt_count + 1

      const result = await sendDelivery({
        route,
        incident,
        workflowName: workflow?.name ?? 'Unknown workflow',
      })

      if (result.ok) {
        updateDelivery(db, delivery.id, {
          status: 'delivered',
          attempt_count: nextAttempt,
          sent_at: now,
          next_retry_at: null,
        })
      } else if (!result.retryable || nextAttempt >= MAX_ATTEMPTS) {
        updateDelivery(db, delivery.id, {
          status: 'failed',
          attempt_count: nextAttempt,
          sent_at: now,
          next_retry_at: null,
        })
      } else {
        updateDelivery(db, delivery.id, {
          attempt_count: nextAttempt,
          next_retry_at: new Date(Date.parse(now) + RETRY_DELAY_MS).toISOString(),
        })
      }
    }

    return processed
  } finally {
    processing = false
  }
}
