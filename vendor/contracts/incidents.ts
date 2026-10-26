/**
 * Incident contracts - state machine, events, and API shapes.
 *
 * Incidents are the primary alert objects in YieldCue. They are opened, escalated,
 * and resolved by the evaluation engine, and trigger alert delivery via notification channels.
 * State transitions are governed by {@link ALLOWED_TRANSITIONS} and validated by the state machine.
 */

import type { Severity } from './severity.ts'

export const INCIDENT_STATUSES = ['open', 'acknowledged', 'resolved', 'ignored'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

/**
 * Valid state transitions for the incident state machine.
 */
export const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['acknowledged', 'resolved', 'ignored'],
  acknowledged: ['resolved', 'ignored'],
  resolved: ['open'], // recurrence
  ignored: ['open'],  // re-opened
}

/**
 * Core incident model. Uses optimistic concurrency via `state_version`.
 * Fingerprinted for dedup - same condition on same check produces same fingerprint.
 */
export interface Incident {
  id: string
  tenant_id: string
  workflow_id: string | null
  client_id: string | null
  check_id: string | null
  fingerprint: string
  title: string
  /**
   * Human-readable compact evidence.
   *
   * The `incidents.description` column is nullable `text` at the database level
   * (legacy rows may hold NULL), but every writer in this codebase persists a
   * string. Treat this field as a required string and coalesce NULL to `''` on
   * read paths that can encounter legacy rows.
   */
  description: string
  status: IncidentStatus
  severity: Severity
  assigned_to: string | null
  state_version: number
  opened_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  last_resolved_at: string | null
  created_at: string
  updated_at: string
}

export const INCIDENT_EVENT_KINDS = [
  'opened', 'acknowledged', 'resolved', 'ignored', 'reopened',
  'assigned', 'escalated', 'updated', 'auto_resolved',
] as const

export type IncidentEventKind = (typeof INCIDENT_EVENT_KINDS)[number]

/** Append-only audit log entry for an incident lifecycle event. */
export interface IncidentEvent {
  id: string
  tenant_id: string
  incident_id: string
  kind: IncidentEventKind
  actor_user_id?: string
  payload: Record<string, unknown>
  created_at: string
}

export interface AcknowledgeIncidentRequest {
  state_version: number
  message?: string
}

export interface ResolveIncidentRequest {
  state_version: number
  message?: string
}

export interface IgnoreIncidentRequest {
  state_version: number
  reason?: string
}

export interface AssignIncidentRequest {
  state_version: number
  user_id: string
  message?: string
}

export interface IncidentListQuery {
  status?: IncidentStatus
  severity?: Severity
  workflow_id?: string
  /** Use "none" to request incidents where client_id is null. */
  client_id?: string
  assigned_to?: string
  cursor?: string
  limit?: number
}

export interface IncidentListResponse {
  incidents: Incident[]
  next_cursor: string | null
}

/** Runtime guard: checks if a status transition is allowed by the state machine. */
export function isValidTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}
