/**
 * Background timer (§8.3): heartbeat overdue sweep, alert delivery outbox,
 * and once-per-UTC-day retention.
 */

import type { DatabaseSync } from 'node:sqlite'
import type { EvaluationAction, HeartbeatCheckConfig } from '@yieldcue/contracts'
import { computeFingerprint, evaluateHeartbeat } from '@yieldcue/domain'
import { CLIENT_TENANT_ID, checkRowToDomain } from './db/types.ts'
import { listWorkflows } from './db/workflows.ts'
import { listChecks } from './db/checks.ts'
import { getLastHeartbeatAt } from './db/events.ts'
import { getIncidentByFingerprint } from './db/incidents.ts'
import { upsertCheckState } from './db/check-state.ts'
import { applyActions } from './engine/apply-actions.ts'
import { processDueDeliveries } from './engine/process-deliveries.ts'

const TICK_MS = 60_000
const EVENT_RETENTION_DAYS = 90
const INCIDENT_RETENTION_DAYS = 365
const DELIVERY_RETENTION_DAYS = 180
const DAY_MS = 86_400_000

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

async function sweepHeartbeats(db: DatabaseSync): Promise<void> {
  const now = new Date().toISOString()

  for (const workflow of listWorkflows(db)) {
    const lastEventAt = getLastHeartbeatAt(db, workflow.id)

    for (const row of listChecks(db, workflow.id)) {
      const check = checkRowToDomain(row)
      if (!check.is_enabled || check.check_type !== 'heartbeat') continue

      const config = check.config as HeartbeatCheckConfig
      const result = evaluateHeartbeat({
        config,
        lastEventAt,
        anchor: check.created_at,
        now,
      })

      if (result.shouldFire) {
        const fingerprint = await computeFingerprint({
          tenantId: CLIENT_TENANT_ID,
          workflowId: workflow.id,
          checkId: check.id,
        })
        const existing = getIncidentByFingerprint(db, fingerprint)
        const active =
          existing && (existing.status === 'open' || existing.status === 'acknowledged')

        const action: EvaluationAction = active
          ? {
              type: 'update_incident',
              fingerprint,
              checkId: check.id,
              severity: check.severity,
              incident: {
                id: existing.id,
                tenant_id: CLIENT_TENANT_ID,
                description: result.reason ?? check.name,
                severity: check.severity,
              },
              reason: result.reason,
            }
          : {
              type: 'create_incident',
              fingerprint,
              checkId: check.id,
              severity: check.severity,
              incident: {
                tenant_id: CLIENT_TENANT_ID,
                workflow_id: workflow.id,
                client_id: null,
                check_id: check.id,
                fingerprint,
                title: check.name,
                description: result.reason ?? check.name,
                status: 'open',
                severity: check.severity,
                opened_at: now,
              },
              reason: result.reason,
            }

        applyActions(db, [action], { workflowName: workflow.name, now })
      }

      upsertCheckState(db, {
        check_id: check.id,
        next_expected_at: result.nextExpectedAt ?? null,
        last_evaluated_at: now,
      })
    }
  }
}

function runRetention(db: DatabaseSync): void {
  const nowMs = Date.now()
  const deliveriesCutoff = new Date(nowMs - DELIVERY_RETENTION_DAYS * DAY_MS).toISOString()
  const eventsCutoff = new Date(nowMs - EVENT_RETENTION_DAYS * DAY_MS).toISOString()
  const incidentsCutoff = new Date(nowMs - INCIDENT_RETENTION_DAYS * DAY_MS).toISOString()

  db.exec('BEGIN')
  try {
    db.prepare(
      "DELETE FROM alert_deliveries WHERE status IN ('delivered','failed') AND sent_at < ?"
    ).run(deliveriesCutoff)
    db.prepare('DELETE FROM events WHERE received_at < ?').run(eventsCutoff)
    db.prepare('DELETE FROM incidents WHERE opened_at < ?').run(incidentsCutoff)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function startScheduler(db: DatabaseSync): void {
  let running = false
  let lastRetentionDate = ''

  async function tick(): Promise<void> {
    if (running) return
    running = true
    try {
      await sweepHeartbeats(db)
      await processDueDeliveries(db)

      const today = utcDate()
      if (today !== lastRetentionDate) {
        runRetention(db)
        lastRetentionDate = today
      }
    } catch (error) {
      console.error('Scheduler tick failed:', error)
    } finally {
      running = false
    }
  }

  void tick()
  setInterval(() => void tick(), TICK_MS).unref()
}
