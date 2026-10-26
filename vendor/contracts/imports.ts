/**
 * Self-hosted setup bundle contracts.
 *
 * The bundle is the only accepted input for `POST /v1/imports/self-hosted`.
 * It carries workflows and workflow-scoped checks, never events, incidents,
 * alert destinations, tokens, or credentials. `check_type` is the top-level
 * discriminator for checks; `config` never carries a `type` field.
 */

import type {
  BaselineDropCheckConfig,
  BaselineSpikeCheckConfig,
  CheckType,
  DataFreshnessCheckConfig,
  ExpectedValueCheckConfig,
  HeartbeatCheckConfig,
  NoChangeCheckConfig,
  RepeatedFailureCheckConfig,
  StatusMatchCheckConfig,
  ThresholdMaxCheckConfig,
  ThresholdMinCheckConfig,
  ZeroOutputCheckConfig,
} from './workflows.ts'
import type { Severity } from './severity.ts'

export const SELF_HOSTED_SETUP_FORMAT = 'yieldcue-self-hosted-setup'
export const SELF_HOSTED_SETUP_VERSION = 1

export type SelfHostedWorkflowStatus = 'active' | 'paused' | 'disabled'

/** Setup hints carried by a workflow; no other metadata keys are accepted. */
export interface SelfHostedSetupMetadata {
  provider?: string
  environment?: string
}

export interface SelfHostedSetupWorkflow {
  /** Opaque source ID local to the self-hosted client. Never becomes a cloud ID. */
  id: string
  workflow_key: string
  name: string
  description?: string
  status?: SelfHostedWorkflowStatus
  metadata?: SelfHostedSetupMetadata
}

/** Canonical config shape for each check type, keyed by `check_type`. */
export interface SelfHostedCheckConfigByType {
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

export type SelfHostedSetupCheck = {
  [K in CheckType]: {
    /** Opaque source ID local to the self-hosted client. Never becomes a cloud ID. */
    id: string
    /** Source workflow ID; mapped to a new cloud workflow ID during import. */
    workflow_id: string
    check_type: K
    name: string
    description?: string
    config: SelfHostedCheckConfigByType[K]
    severity?: Severity
    is_enabled?: boolean
  }
}[CheckType]

/** Informational counts of records deliberately excluded from the bundle. */
export interface SelfHostedSetupOmitted {
  events: number
  incidents: number
  alert_destinations: number
}

export interface SelfHostedSetupBundle {
  format: typeof SELF_HOSTED_SETUP_FORMAT
  setup_version: typeof SELF_HOSTED_SETUP_VERSION
  bundle_id: string
  /** RFC 3339 UTC timestamp ending in `Z`. */
  created_at: string
  workflows: SelfHostedSetupWorkflow[]
  checks: SelfHostedSetupCheck[]
  omitted: SelfHostedSetupOmitted
}

/** Workflow summary included in the stable import result. */
export interface SelfHostedImportedWorkflow {
  id: string
  workflow_key: string
  name: string
}

export interface SelfHostedImportResult {
  bundle_id: string
  duplicate: boolean
  imported: {
    workflow_count: number
    check_count: number
    workflows: SelfHostedImportedWorkflow[]
  }
  omitted: SelfHostedSetupOmitted
}

export type SelfHostedImportErrorCode =
  | 'IMPORT_BUNDLE_ID_REUSED'
  | 'IMPORT_CONFLICT'
  | 'PLAN_LIMIT_EXCEEDED'
  | 'INVALID_INPUT'
  | 'PAYLOAD_TOO_LARGE'

/** Conflict entry returned in `error.details.conflicts` for `IMPORT_CONFLICT`. */
export interface SelfHostedImportConflict {
  source_workflow_id: string
  workflow_key: string
  reason: 'workflow_key_exists' | 'clientless_name_exists'
}

/** Capacity entry returned in `error.details.limits` for `PLAN_LIMIT_EXCEEDED`. */
export interface SelfHostedImportLimit {
  resource: 'workflow' | 'check'
  current_usage: number
  requested_count: number
  limit: number
}
