/**
 * Workflow, Client, and Check contracts.
 *
 * Workflows represent monitored data pipelines. Clients represent external consumers.
 * Checks define the evaluation rules that produce incidents when conditions are met.
 */

import type { Event, EventType } from './events.ts'
import type { IncidentStatus } from './incidents.ts'
import type { Severity } from './severity.ts'

/** An external consumer of a workflow's data pipeline. */
export interface Client {
  id: string
  tenant_id: string
  external_key: string
  name: string
  metadata: Record<string, unknown>
  status: 'active' | 'disabled'
  created_at: string
  updated_at: string
}

export interface CreateClientRequest {
  external_key: string
  name: string
  metadata?: Record<string, unknown>
}

export interface UpdateClientRequest {
  name?: string
  metadata?: Record<string, unknown>
  status?: 'active' | 'disabled'
}

export interface ListClientsQuery {
  cursor?: string
  limit?: number
}

export interface ListClientsResponse {
  clients: Client[]
  next_cursor: string | null
}

/** A monitored data pipeline belonging to a tenant. */
export interface Workflow {
  id: string
  tenant_id: string
  client_id: string | null
  workflow_key: string
  name: string
  description: string
  metadata: Record<string, unknown>
  status: 'active' | 'paused' | 'disabled'
  created_at: string
  updated_at: string
}

export interface CreateWorkflowRequest {
  workflow_key: string
  name: string
  description?: string
  client_id?: string
  metadata?: Record<string, unknown>
}

export interface UpdateWorkflowRequest {
  name?: string
  description?: string
  metadata?: Record<string, unknown>
  status?: 'active' | 'paused' | 'disabled'
}

export interface ListWorkflowsQuery {
  /** Use "none" to request workflows where client_id is null. */
  client_id?: string
  cursor?: string
  limit?: number
}

export interface ListWorkflowsResponse {
  workflows: Workflow[]
  next_cursor: string | null
}

export interface WorkflowTestEventResponse {
  event_id: string | null
  accepted: boolean
  duplicate: boolean
  check_id?: string
  incident_id?: string
  mode?: 'event' | 'heartbeat_overdue'
  evaluation_status?: 'queued' | 'completed'
}

export interface WorkflowTestEventRequest {
  check_id?: string
}

export interface ListWorkflowEventsResponse {
  events: Event[]
  next_cursor: null
}

export interface WorkflowTimelineEventSummary {
  id: string
  event_type: EventType
  status: string
  provider: string | null
  idempotency_key: string
  received_at: string
}

export interface WorkflowTimelineIncidentSummary {
  id: string
  title: string
  description: string
  status: IncidentStatus
  severity: Severity
  opened_at: string
  resolved_at: string | null
}

export interface WorkflowTimelineResponse {
  events: WorkflowTimelineEventSummary[]
  incidents: WorkflowTimelineIncidentSummary[]
}

export type CheckInferenceFieldKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'timestamp'
  | 'array'
  | 'object'
  | 'null'

export type CheckInferenceFieldRole =
  | 'metric'
  | 'metric_inverse'
  | 'metric_diagnostic'
  | 'flag'
  | 'status'
  | 'timestamp'
  | 'dimension'
  | 'run_identity'
  | 'context'
  | 'collection'
  | 'unsupported'

export interface CheckInferenceRequest {
  sample_payload: unknown
}

export interface CheckInferenceDetectedField {
  path: string
  kind: CheckInferenceFieldKind
  role: CheckInferenceFieldRole
  example?: string | number | boolean | null
}

/** Field map produced from a sample payload. The user reads this and configures checks explicitly. */
export interface CheckInferenceResponse {
  detected_fields: CheckInferenceDetectedField[]
  /** True when a sampling limit (depth, field count, or array items) dropped fields from the map. */
  truncated: boolean
}

export type SampleCaptureStatus = 'waiting' | 'received' | 'expired'

export interface SampleCaptureSession {
  id: string
  tenant_id: string
  workflow_id: string
  created_by_user_id: string | null
  status: SampleCaptureStatus
  inference_result: CheckInferenceResponse | null
  last_error_code: string | null
  last_error_message: string | null
  expires_at: string
  received_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateSampleCaptureResponse {
  capture: SampleCaptureSession
  capture_url: string
}

export interface DeleteSampleCaptureResponse {
  deleted: true
}

export const CHECK_TYPES = [
  'heartbeat',
  'zero_output',
  'threshold_min',
  'threshold_max',
  'baseline_drop',
  'baseline_spike',
  'status_match',
  'expected_value',
  'repeated_failure',
  'data_freshness',
  'no_change',
] as const

export type CheckType = (typeof CHECK_TYPES)[number]

/** Fields shared by every check regardless of type. */
export interface CheckBase {
  id: string
  tenant_id: string
  workflow_id: string
  name: string
  description: string
  severity: Severity
  is_enabled: boolean
  created_at: string
  updated_at: string
}

/** Canonical config shape for each check type, keyed by `check_type`. */
export interface CheckConfigByType {
  heartbeat: HeartbeatCheckConfig
  zero_output: ZeroOutputCheckConfig
  threshold_min: ThresholdMinCheckConfig
  threshold_max: ThresholdMaxCheckConfig
  baseline_drop: BaselineDropCheckConfig
  baseline_spike: BaselineSpikeCheckConfig
  status_match: StatusMatchCheckConfig
  expected_value: ExpectedValueCheckConfig
  repeated_failure: RepeatedFailureCheckConfig
  data_freshness: DataFreshnessCheckConfig
  no_change: NoChangeCheckConfig
}

/**
 * A check rule attached to a workflow.
 *
 * Discriminated by `check_type`: narrowing on `check_type` also narrows `config`
 * to the matching {@link CheckConfigByType} member. `config` never carries a
 * `type` key (see TECHNICAL_SPEC.md §5.8).
 */
export type Check = {
  [K in CheckType]: CheckBase & {
    check_type: K
    config: CheckConfigByType[K]
  }
}[CheckType]

export interface CreateCheckRequest {
  workflow_id: string
  check_type: CheckType
  name: string
  description?: string
  config: CheckConfig
  severity?: Severity
}

export interface UpdateCheckRequest {
  name?: string
  description?: string
  config?: CheckConfig
  severity?: Severity
  is_enabled?: boolean
}

/** Union of all canonical check configs. Use {@link Check} to correlate with `check_type`. */
export type CheckConfig = CheckConfigByType[CheckType]

export interface HeartbeatCheckConfig {
  interval_minutes: number
  grace_minutes: number
}

export interface ZeroOutputCheckConfig {
  /** The metric key to evaluate. Must match the key emitted in the signal event's metrics object. */
  metric_key: string
  /** Whether a zero value is healthy. Required by the canonical config schema. */
  allowed_zero: boolean
}

export interface ThresholdMinCheckConfig {
  metric_key: string
  threshold_min: number
}

export interface ThresholdMaxCheckConfig {
  metric_key: string
  threshold_max: number
}

export interface BaselineDropCheckConfig {
  metric_key: string
  drop_percent: number
  lookback_days: number
  min_sample_count: number
}

export interface BaselineSpikeCheckConfig {
  metric_key: string
  /** Percentage above baseline that triggers the check. */
  spike_percent: number
  lookback_days: number
  min_sample_count: number
}

export interface StatusMatchCheckConfig {
  /** Dot-notation path to the string field in the signal event context (e.g. `import_state`). */
  field_path: string
  /** Value that indicates a failure state (e.g. `FAILED`). */
  failure_value: string
  /** Match mode: `exact` requires full equality (default); `prefix` matches the start of the field value. */
  match_mode?: 'exact' | 'prefix'
}

export interface ExpectedValueCheckConfig {
  /** Dot-notation path to the field in the signal event context. */
  field_path: string
  /** The value the field must always equal. */
  expected_value: boolean | string
  /** Declared field type - determines how expected_value is compared. */
  field_type: 'boolean' | 'string'
}

export interface DataFreshnessCheckConfig {
  /** Dot-notation path to the timestamp field in the signal event context (e.g. `data_as_of`). */
  field_path: string
  /** Maximum acceptable age of the timestamp in hours. */
  max_staleness_hours: number
}

export interface RepeatedFailureCheckConfig {
  window_minutes: number
  failure_count_threshold: number
}

export interface NoChangeCheckConfig {
  metric_key: string
  consecutive_runs: number
  tolerance_percent: number
}
