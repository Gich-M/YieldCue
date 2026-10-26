import type {
  Check,
  Event,
  Incident,
  Severity,
} from '@yieldcue/contracts'
import type { CheckEvalResult } from '../checks/types.ts'
import type { EvaluationAction } from '@yieldcue/contracts/evaluator.ts'

function buildCreateAction(
  event: Event,
  check: Check,
  fingerprint: string,
  result: CheckEvalResult,
  now: string
): EvaluationAction {
  return {
    type: 'create_incident',
    fingerprint,
    checkId: check.id,
    severity: check.severity,
    incident: {
      tenant_id: event.tenant_id,
      workflow_id: event.workflow_id,
      client_id: event.client_id,
      check_id: check.id,
      fingerprint,
      title: check.name,
      description: result.reason ?? `Check '${check.name}' triggered`,
      status: 'open',
      severity: check.severity,
      opened_at: now,
    },
    reason: result.reason,
  }
}

function shouldEscalateSeverity(current: Severity, incoming: Severity): boolean {
  const order: Record<Severity, number> = { critical: 3, warning: 2, info: 1 }
  return (order[incoming] ?? 0) > (order[current] ?? 0)
}

function buildUpdateAction(
  existing: Incident,
  check: Check,
  fingerprint: string,
  result: CheckEvalResult
): EvaluationAction {
  const shouldEscalate = shouldEscalateSeverity(existing.severity, check.severity)

  return {
    type: 'update_incident',
    fingerprint,
    checkId: check.id,
    severity: shouldEscalate ? check.severity : existing.severity,
    incident: {
      id: existing.id,
      tenant_id: existing.tenant_id,
      description: result.reason ?? existing.description,
      severity: shouldEscalate ? check.severity : existing.severity,
    },
    reason: result.reason,
  }
}

function isActiveIncident(incident: Incident | undefined): incident is Incident {
  return Boolean(
    incident && (incident.status === 'open' || incident.status === 'acknowledged')
  )
}

function isIgnoredIncident(incident: Incident | undefined): incident is Incident {
  return incident?.status === 'ignored'
}

/** Appends the incident action(s) implied by a check evaluation result to `actions`. */
export function pushOutcomeAction(
  actions: EvaluationAction[],
  event: Event,
  check: Check,
  existing: Incident | undefined,
  fingerprint: string,
  result: CheckEvalResult,
  now: string,
  canResolve: boolean
) {
  if (result.shouldFire) {
    if (isActiveIncident(existing)) {
      actions.push(buildUpdateAction(existing, check, fingerprint, result))
    } else {
      actions.push(buildCreateAction(event, check, fingerprint, result, now))
    }
    return
  }

  if (canResolve && isActiveIncident(existing)) {
    actions.push({
      type: 'resolve_incident',
      fingerprint,
      checkId: check.id,
      reason: result.reason ?? `${check.name} recovered`,
    })
    return
  }

  if (canResolve && isIgnoredIncident(existing)) {
    actions.push({
      type: 'mark_ignored_cleared',
      fingerprint,
      checkId: check.id,
      reason: result.reason ?? `${check.name} recovered while ignored`,
    })
  }
}
