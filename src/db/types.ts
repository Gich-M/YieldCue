/**
 * Client row types and JSON helpers. The client has no tenant, client, or
 * actor columns; shared contracts that require a tenant_id are mapped to a
 * fixed constant at the repository boundary (§8.4, §8.13).
 */

import type { SQLInputValue } from 'node:sqlite'
import type {
  Check,
  CheckType,
  Event,
  Incident,
  IncidentEventKind,
  IncidentStatus,
  Severity,
  Workflow,
} from '@yieldcue/contracts'

export const CLIENT_TENANT_ID = 'self-hosted'

/** Casts a `node:sqlite` row (or undefined) to a client row type. */
export function asRow<T>(row: unknown): T | null {
  return (row as T | undefined) ?? null
}

/** Casts a `node:sqlite` result array to client row types. */
export function asRows<T>(rows: unknown): T[] {
  return (rows as T[]) ?? []
}

export type DbParams = SQLInputValue[]

export interface WorkflowRow {
  id: string
  name: string
  workflow_key: string
  description: string
  metadata: string
  status: Workflow['status']
  created_at: string
  updated_at: string
}

export interface CheckRow {
  id: string
  workflow_id: string
  check_type: CheckType
  name: string
  config: string
  severity: Severity
  is_enabled: number
  created_at: string
  updated_at: string
}

export interface EventRow {
  id: string
  workflow_id: string
  event_type: Event['event_type']
  payload: string
  idempotency_key: string | null
  received_at: string
  is_test: number
}

export interface IncidentRow {
  id: string
  workflow_id: string
  check_id: string | null
  status: IncidentStatus
  severity: Severity
  title: string
  description: string
  fingerprint: string
  state_version: number
  opened_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  last_resolved_at: string | null
  updated_at: string
}

export interface IncidentEventRow {
  id: string
  incident_id: string
  kind: IncidentEventKind
  payload: string
  created_at: string
}

export interface AlertRouteRow {
  id: string
  integration_kind: 'slack_webhook' | 'email'
  destination: string
  filter_workflow_id: string | null
  filter_severity: string
  cooldown_minutes: number
  is_enabled: number
}

export interface AlertDeliveryRow {
  id: string
  incident_id: string
  alert_route_id: string
  channel: string
  status: 'pending' | 'delivered' | 'failed'
  state_version: number
  attempt_count: number
  next_retry_at: string | null
  sent_at: string | null
}

export interface CheckStateRow {
  id: string
  check_id: string
  last_event_id: string | null
  last_evaluated_at: string | null
  next_expected_at: string | null
  consecutive_failures: number
  baseline_value: number | null
  state_data: string
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function parseJson<T = Record<string, unknown>>(raw: string): T {
  return JSON.parse(raw) as T
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? {})
}

export function toBool(n: number): boolean {
  return n === 1
}

export function fromBool(b: boolean): number {
  return b ? 1 : 0
}

/** Maps a stored event row to the shared Event contract shape. */
export function eventRowToDomain(row: EventRow): Event {
  return {
    id: row.id,
    tenant_id: CLIENT_TENANT_ID,
    workflow_id: row.workflow_id,
    client_id: null,
    event_type: row.event_type,
    is_test: toBool(row.is_test),
    payload: parseJson(row.payload),
    idempotency_key: row.idempotency_key,
    source_ip: null,
    received_at: row.received_at,
  }
}

/** Maps a stored check row to the shared Check contract shape. */
export function checkRowToDomain(row: CheckRow): Check {
  return {
    id: row.id,
    tenant_id: CLIENT_TENANT_ID,
    workflow_id: row.workflow_id,
    name: row.name,
    description: '',
    severity: row.severity,
    is_enabled: toBool(row.is_enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
    check_type: row.check_type,
    config: parseJson(row.config),
  } as Check
}

/** Maps a stored incident row to the shared Incident contract shape. */
export function incidentRowToDomain(row: IncidentRow): Incident {
  return {
    id: row.id,
    tenant_id: CLIENT_TENANT_ID,
    workflow_id: row.workflow_id,
    client_id: null,
    check_id: row.check_id,
    fingerprint: row.fingerprint,
    title: row.title,
    description: row.description,
    status: row.status,
    severity: row.severity,
    assigned_to: null,
    state_version: row.state_version,
    opened_at: row.opened_at,
    acknowledged_at: row.acknowledged_at,
    resolved_at: row.resolved_at,
    last_resolved_at: row.last_resolved_at,
    created_at: row.opened_at,
    updated_at: row.updated_at,
  }
}
