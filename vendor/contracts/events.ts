/**
 * Event contracts - types for the append-only telemetry ledger.
 *
 * Events are the immutable input to the incident engine. Once persisted,
 * events are never modified - only evaluated by checks and referenced by incidents.
 */

export const EVENT_TYPES = ['heartbeat', 'signal'] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** A persisted telemetry event in the append-only ledger. */
export interface Event {
  id: string
  tenant_id: string
  workflow_id: string
  client_id: string | null
  event_type: EventType
  is_test: boolean
  payload: Record<string, unknown>
  idempotency_key: string | null
  source_ip: string | null
  received_at: string
}

export const EVENT_STATUSES = ['ok', 'warn', 'error'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

/** Numeric metric values emitted by a signal event (TECHNICAL_SPEC.md §6). */
export interface EventMetrics {
  [key: string]: number
}

export interface EventContext {
  [key: string]: unknown
}

export interface IngestEventRequest {
  event_type: EventType
  workflow_key?: string
  client_key?: string
  idempotency_key?: string
  provider_run_id?: string
  occurred_at: string
  status: EventStatus
  metrics?: EventMetrics
  context: EventContext
  is_test?: boolean
  ingest_version: number
}

/** Canonical ingest response - returned by POST /v1/ingest/events. */
export interface IngestEventResponse {
  event_id: string
  accepted: boolean
  duplicate: boolean
}

export const DEAD_LETTER_REASONS = [
  'validation_failed',
  'unknown_workflow',
  'unknown_client',
  'processing_failed',
  'max_retries_exceeded',
] as const

export type DeadLetterReason = (typeof DEAD_LETTER_REASONS)[number]

/** An event that failed validation or processing and was dead-lettered. Payloads are redacted. */
export interface DeadLetterEvent {
  id: string
  tenant_id: string
  original_payload: Record<string, unknown>
  reason_code: DeadLetterReason
  reason_message?: string
  source_ip?: string
  created_at: string
}

/** Runtime guard: checks if a value is a valid EventType literal. */
export function isValidEventType(value: unknown): value is EventType {
  return typeof value === 'string' && EVENT_TYPES.includes(value as EventType)
}
