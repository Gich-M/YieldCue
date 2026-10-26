import type { Event } from './events.ts'
import type { Check } from './workflows.ts'
import type { Incident } from './incidents.ts'
import type { Severity } from './severity.ts'

/** Per-check mutable state passed into the evaluator for stateful checks (e.g. no_change). */
export interface CheckStateSnapshot {
  state_data: Record<string, unknown>
  consecutive_failures: number
  last_evaluated_at?: string
}

export interface EvaluationContext {
  event: Event
  checks: Check[]
  now: string
  existingIncidents?: Map<string, Incident>
  evaluatedPairs?: Set<string>
  workflowEvents?: Event[]
  checkStates?: Map<string, CheckStateSnapshot>
}

/** Incident fields required to create an incident row from an evaluation action. */
export type IncidentCreateAction = Pick<
  Incident,
  | 'tenant_id'
  | 'workflow_id'
  | 'client_id'
  | 'check_id'
  | 'fingerprint'
  | 'title'
  | 'description'
  | 'status'
  | 'severity'
  | 'opened_at'
>

/** Incident fields an evaluation action may update on an existing incident. */
export type IncidentUpdateAction = Pick<
  Incident,
  'id' | 'tenant_id' | 'description' | 'severity'
>

/**
 * Discriminated action emitted by the evaluator.
 *
 * Each variant carries exactly the payload its consumer needs; `type` is the
 * discriminant. Fingerprint keys the incident lineage for every incident action.
 */
export type EvaluationAction =
  | {
      type: 'create_incident'
      fingerprint: string
      checkId: string
      severity: Severity
      incident: IncidentCreateAction
      reason?: string
    }
  | {
      type: 'update_incident'
      fingerprint: string
      checkId: string
      severity: Severity
      incident: IncidentUpdateAction
      reason?: string
    }
  | {
      type: 'resolve_incident'
      fingerprint: string
      checkId: string
      reason?: string
    }
  | {
      type: 'enqueue_alert'
      fingerprint: string
      checkId?: string
      reason?: string
    }
  | {
      type: 'mark_ignored_cleared'
      fingerprint: string
      checkId: string
      reason?: string
    }
  | {
      type: 'update_check_state'
      checkId: string
      stateData: Record<string, unknown>
    }
