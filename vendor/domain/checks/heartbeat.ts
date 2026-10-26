import type { HeartbeatCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface HeartbeatEvalInput {
  config: HeartbeatCheckConfig
  lastEventAt: string | null
  /** Import-time anchor (`check.created_at`); used before the first heartbeat arrives. */
  anchor: string
  now: string
}

/** Evaluates heartbeat freshness: fires when no event arrived within interval + grace. */
export function evaluateHeartbeat(input: HeartbeatEvalInput): CheckEvalResult {
  const { config, lastEventAt, anchor, now } = input
  const nowMs = new Date(now).getTime()

  const referenceMs = lastEventAt
    ? new Date(lastEventAt).getTime()
    : new Date(anchor).getTime()

  const intervalMs = config.interval_minutes * 60_000
  const graceMs = config.grace_minutes * 60_000
  // The deadline is the scheduling value persisted as `check_state.next_expected_at`:
  // a heartbeat is overdue once `now` passes reference + interval + grace.
  const deadlineMs = referenceMs + intervalMs + graceMs
  const nextExpectedAt = new Date(deadlineMs).toISOString()

  if (nowMs > deadlineMs) {
    const overdueMinutes = Math.round((nowMs - deadlineMs) / 60_000)
    return {
      shouldFire: true,
      reason: `Heartbeat overdue by ${overdueMinutes} minute(s) (interval: ${config.interval_minutes}m, grace: ${config.grace_minutes}m)`,
      nextExpectedAt,
    }
  }

  return { shouldFire: false, nextExpectedAt }
}
