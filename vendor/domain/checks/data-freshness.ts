import type { DataFreshnessCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface DataFreshnessEvalInput {
  config: DataFreshnessCheckConfig
  /**
   * Raw value at `field_path` in the event context. Null/undefined means absent;
   * a present non-string is a type mismatch and fires.
   */
  timestampValue: unknown
  /** The event's arrival time (ISO-8601); staleness is measured against this. */
  receivedAt: string
}

export interface DataFreshnessEvalResult extends CheckEvalResult {
  /** True when the timestamp is present and parseable, i.e. safe to resolve on. */
  canResolve: boolean
}

/**
 * ISO-8601 timestamp predicate: full date-time with a timezone designator.
 * Mirrors the `occurred_at` ingest predicate (apps/edge .../ingest/validation.ts).
 */
const ISO_8601_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

/** True when `value` is a string that parses as a timezone-qualified ISO-8601 timestamp. */
export function isIso8601Timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_8601_TIMESTAMP_PATTERN.test(value)) {
    return false
  }

  return !Number.isNaN(Date.parse(value))
}

/** Evaluates data staleness: fires when the field timestamp is older than `max_staleness_hours`. */
export function evaluateDataFreshness(input: DataFreshnessEvalInput): DataFreshnessEvalResult {
  const { config, timestampValue, receivedAt } = input

  if (timestampValue === null || timestampValue === undefined) {
    return {
      shouldFire: false,
      reason: `Field '${config.field_path}' not present in payload`,
      canResolve: false,
    }
  }

  if (typeof timestampValue !== 'string') {
    return {
      shouldFire: true,
      reason: `Field '${config.field_path}' is not an ISO-8601 timestamp`,
      canResolve: false,
    }
  }

  if (!isIso8601Timestamp(timestampValue)) {
    return {
      shouldFire: false,
      reason: `Field '${config.field_path}' is not an ISO-8601 timestamp`,
      canResolve: false,
    }
  }

  const fieldMs = Date.parse(timestampValue)

  const receivedMs = Date.parse(receivedAt)
  const maxStalenessMs = config.max_staleness_hours * 60 * 60_000
  const ageMs = receivedMs - fieldMs

  if (ageMs > maxStalenessMs) {
    const ageHours = (ageMs / 3_600_000).toFixed(1)
    return {
      shouldFire: true,
      reason: `${config.field_path} is ${ageHours}h old (max: ${config.max_staleness_hours}h)`,
      canResolve: false,
    }
  }

  return { shouldFire: false, canResolve: true }
}
