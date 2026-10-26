import { isRecord, type Event } from '@yieldcue/contracts'
import type { EvaluationContext } from '@yieldcue/contracts/evaluator.ts'

export function getPayload(event: Event): Record<string, unknown> {
  return isRecord(event.payload) ? event.payload : {}
}

export function getMetrics(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload.metrics) ? payload.metrics : {}
}

export function getContext(payload: Record<string, unknown>): Record<string, unknown> {
  return isRecord(payload.context) ? payload.context : {}
}

export function readNumericMetric(
  metrics: Record<string, unknown>,
  metricKey: string
): number | null {
  const value = metrics[metricKey]
  return typeof value === 'number' ? value : null
}

export function readStringField(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Reads a value from a record by dot-notation path (e.g. `"result.import_state"`).
 * Returns the raw value at the path, or null if any segment is absent or not a record.
 *
 * Depth is capped at 8 segments: no legitimate field_path exceeds this, and the cap
 * bounds evaluation cost when a crafted path meets a deeply nested ingest payload.
 */
export function readFieldByPath(
  record: Record<string, unknown>,
  path: string
): unknown {
  const segments = path.split('.')
  // Cap depth to prevent unbounded traversal of externally-supplied payloads.
  if (segments.length > 8) return null
  let current: unknown = record
  for (const segment of segments) {
    if (!isRecord(current)) return null
    current = (current as Record<string, unknown>)[segment]
  }
  return current ?? null
}

/**
 * Processing timestamp for windowing.
 *
 * Always uses the server-generated `received_at`. Client-supplied `occurred_at`
 * may be late or skewed and must never move an event outside a baseline or
 * failure window (TECHNICAL_SPEC.md §5.9; incident-engine.md "Evaluation Ordering").
 */
export function getEventTimestamp(event: Event): number {
  return Date.parse(event.received_at)
}

/** Arithmetic mean of `values`, or null when the sample is empty. */
export function meanOrNull(values: number[]): number | null {
  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Reads the `ignored_cleared_at` marker persisted in check state when an ignored
 * incident's condition clears. Returns null when the marker is absent or invalid.
 */
export function readIgnoredClearedAt(
  stateData: Record<string, unknown> | undefined
): string | null {
  const value = stateData?.ignored_cleared_at
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isFailureSignal(event: Event): boolean {
  if (event.event_type !== 'signal') {
    return false
  }

  return readStringField(getPayload(event), 'status') === 'error'
}

export function getWorkflowEvents(ctx: EvaluationContext): Event[] {
  const byId = new Map<string, Event>()

  for (const workflowEvent of ctx.workflowEvents ?? []) {
    byId.set(workflowEvent.id, workflowEvent)
  }

  byId.set(ctx.event.id, ctx.event)
  return [...byId.values()]
}

export function getHistoricalMetricValues(
  events: Event[],
  currentEvent: Event,
  metricKey: string,
  lookbackDays: number
): number[] {
  const currentTimestamp = getEventTimestamp(currentEvent)
  const lookbackMs = lookbackDays * 24 * 60 * 60_000
  const cutoff = currentTimestamp - lookbackMs

  return events
    .filter((event) => event.id !== currentEvent.id && event.event_type === 'signal')
    .filter((event) => {
      const timestamp = getEventTimestamp(event)
      return !Number.isNaN(timestamp) && timestamp >= cutoff && timestamp <= currentTimestamp
    })
    .map((event) => readNumericMetric(getMetrics(getPayload(event)), metricKey))
    .filter((value): value is number => value !== null)
}

export function getFailureCount(
  events: Event[],
  currentEvent: Event,
  windowMinutes: number
): number {
  const currentTimestamp = getEventTimestamp(currentEvent)
  const cutoff = currentTimestamp - (windowMinutes * 60_000)

  return events
    .filter((event) => event.event_type === 'signal')
    .filter((event) => {
      const timestamp = getEventTimestamp(event)
      return !Number.isNaN(timestamp) && timestamp >= cutoff && timestamp <= currentTimestamp
    })
    .filter(isFailureSignal)
    .length
}
