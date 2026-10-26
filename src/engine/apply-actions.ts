/**
 * Applies evaluator actions to the SQLite store within the ingest transaction.
 *
 * This is where the client owns the incident lifecycle the pure evaluator does
 * not: recurrence cooldown on reopen, the ignored-until-cleared policy, and
 * enqueueing alert deliveries. All functions here are synchronous and run
 * inside the caller's transaction.
 */

import type { DatabaseSync } from 'node:sqlite'
import type { EvaluationAction, Severity } from '@yieldcue/contracts'
import { computeRecurrenceCooldown, readIgnoredClearedAt } from '@yieldcue/domain'
import { isInCooldown } from '@yieldcue/notifications'
import {
  appendIncidentEvent,
  getIncident,
  getIncidentByFingerprint,
  insertIncident,
  updateIncident,
} from '../db/incidents.ts'
import { getCheckState, upsertCheckState } from '../db/check-state.ts'
import { listAlertRoutes } from '../db/alert-routes.ts'
import { getLatestDeliveredAt, insertDelivery } from '../db/deliveries.ts'
import { parseJson, type IncidentRow } from '../db/types.ts'
import { matchAlertRoutes } from './route-matcher.ts'

const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, critical: 3 }

export interface ApplyContext {
  workflowName: string
  now: string
}

function isEscalation(from: Severity, to: Severity): boolean {
  return (SEVERITY_RANK[to] ?? 0) > (SEVERITY_RANK[from] ?? 0)
}

export function applyActions(
  db: DatabaseSync,
  actions: EvaluationAction[],
  ctx: ApplyContext
): void {
  for (const action of actions) {
    switch (action.type) {
      case 'create_incident':
        applyCreate(db, action, ctx)
        break
      case 'update_incident':
        applyUpdate(db, action, ctx)
        break
      case 'resolve_incident':
        applyResolve(db, action, ctx)
        break
      case 'mark_ignored_cleared':
        applyIgnoredCleared(db, action, ctx)
        break
      case 'update_check_state':
        upsertCheckState(db, { check_id: action.checkId, state_data: action.stateData })
        break
      case 'enqueue_alert':
        // Not emitted by the V1 evaluator; alert enqueue is driven by create/update.
        break
    }
  }
}

function applyCreate(
  db: DatabaseSync,
  action: Extract<EvaluationAction, { type: 'create_incident' }>,
  ctx: ApplyContext
): void {
  const existing = getIncidentByFingerprint(db, action.fingerprint)

  if (!existing) {
    const incident = insertIncident(db, {
      workflow_id: action.incident.workflow_id ?? '',
      check_id: action.incident.check_id,
      status: action.incident.status,
      severity: action.incident.severity,
      title: action.incident.title,
      description: action.incident.description,
      fingerprint: action.fingerprint,
      opened_at: action.incident.opened_at,
    })
    appendIncidentEvent(db, incident.id, 'opened', { reason: action.reason ?? '' })
    enqueueDeliveries(db, incident, ctx)
    return
  }

  if (existing.status === 'open' || existing.status === 'acknowledged') {
    // The evaluator normally emits update_incident here; this is a defensive path.
    const escalated = isEscalation(existing.severity, action.incident.severity)
    const incident = updateIncident(db, existing.id, {
      description: action.incident.description,
      severity: escalated ? action.incident.severity : existing.severity,
    })!
    appendIncidentEvent(db, existing.id, escalated ? 'escalated' : 'updated', {
      reason: action.reason ?? '',
    })
    if (escalated) enqueueDeliveries(db, incident, ctx)
    return
  }

  if (!canReopen(db, existing, ctx.now)) return

  const wasIgnored = existing.status === 'ignored'
  const incident = updateIncident(db, existing.id, {
    status: 'open',
    acknowledged_at: null,
    resolved_at: null,
    opened_at: ctx.now,
    description: action.incident.description,
    severity: action.incident.severity,
  })!
  if (wasIgnored && existing.check_id) {
    upsertCheckState(db, {
      check_id: existing.check_id,
      state_data: { ignored_cleared_at: null },
    })
  }
  appendIncidentEvent(db, existing.id, 'reopened', { reason: action.reason ?? '' })
  enqueueDeliveries(db, incident, ctx)
}

function canReopen(db: DatabaseSync, incident: IncidentRow, now: string): boolean {
  if (incident.status === 'resolved') {
    if (!incident.last_resolved_at) return false
    return computeRecurrenceCooldown(incident.last_resolved_at, now)
  }
  if (incident.status === 'ignored') {
    if (!incident.check_id) return false
    const state = getCheckState(db, incident.check_id)
    return readIgnoredClearedAt(state ? parseJson(state.state_data) : undefined) !== null
  }
  return false
}

function applyUpdate(
  db: DatabaseSync,
  action: Extract<EvaluationAction, { type: 'update_incident' }>,
  ctx: ApplyContext
): void {
  const existing = getIncident(db, action.incident.id)
  if (!existing) return

  const escalated = isEscalation(existing.severity, action.incident.severity)
  const incident = updateIncident(db, existing.id, {
    description: action.incident.description,
    severity: escalated ? action.incident.severity : existing.severity,
  })!
  appendIncidentEvent(db, existing.id, escalated ? 'escalated' : 'updated', {
    reason: action.reason ?? '',
  })
  if (escalated) enqueueDeliveries(db, incident, ctx)
}

function applyResolve(
  db: DatabaseSync,
  action: Extract<EvaluationAction, { type: 'resolve_incident' }>,
  ctx: ApplyContext
): void {
  const existing = getIncidentByFingerprint(db, action.fingerprint)
  if (!existing) return
  if (existing.status !== 'open' && existing.status !== 'acknowledged') return

  updateIncident(db, existing.id, {
    status: 'resolved',
    resolved_at: ctx.now,
    last_resolved_at: ctx.now,
  })
  appendIncidentEvent(db, existing.id, 'auto_resolved', { reason: action.reason ?? '' })
}

function applyIgnoredCleared(
  db: DatabaseSync,
  action: Extract<EvaluationAction, { type: 'mark_ignored_cleared' }>,
  ctx: ApplyContext
): void {
  const existing = getIncidentByFingerprint(db, action.fingerprint)
  if (!existing || existing.status !== 'ignored') return

  if (existing.check_id) {
    upsertCheckState(db, {
      check_id: existing.check_id,
      state_data: { ignored_cleared_at: ctx.now },
    })
  }
  appendIncidentEvent(db, existing.id, 'updated', {
    ignored_cleared: true,
    reason: action.reason ?? '',
  })
}

function enqueueDeliveries(
  db: DatabaseSync,
  incident: IncidentRow,
  ctx: ApplyContext
): void {
  const routes = listAlertRoutes(db)
  const matched = matchAlertRoutes(routes, {
    workflowId: incident.workflow_id,
    severity: incident.severity,
  })

  for (const route of matched) {
    const lastSentAt = getLatestDeliveredAt(db, route.id, incident.id)
    if (
      isInCooldown({
        incidentId: incident.id,
        alertRouteId: route.id,
        cooldownMinutes: route.cooldown_minutes,
        lastSentAt,
        now: ctx.now,
      })
    ) {
      continue
    }

    insertDelivery(db, {
      incident_id: incident.id,
      alert_route_id: route.id,
      channel: route.integration_kind,
      status: 'pending',
      state_version: incident.state_version,
      attempt_count: 0,
      next_retry_at: null,
      sent_at: null,
    })
  }
}
