import type { NoChangeCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface NoChangeEvalInput {
  config: NoChangeCheckConfig
  metricKey: string
  currentValue: number | null
  previousValue: number | null
  consecutiveCount: number
  now: string
}

export interface NoChangeEvalResult extends CheckEvalResult {
  /** True when the value changed beyond tolerance (the only resolution signal). */
  changed: boolean
  /** Check_state fields to persist, or undefined when the metric is absent. */
  nextState?: Record<string, unknown>
}

/** Evaluates stagnation: fires when a metric stays within tolerance for `consecutive_runs`. */
export function evaluateNoChange(input: NoChangeEvalInput): NoChangeEvalResult {
  const { config, metricKey, currentValue, previousValue, consecutiveCount, now } = input

  if (currentValue === null) {
    return { shouldFire: false, reason: `No ${metricKey} metric available`, changed: false }
  }

  if (previousValue === null) {
    return {
      shouldFire: false,
      reason: `First run - recording initial ${metricKey} value`,
      changed: false,
      nextState: { previous_value: currentValue, consecutive_count: 1, last_changed_at: now },
    }
  }

  const diff = Math.abs(currentValue - previousValue)
  // Tolerances are magnitudes: a signed mean would make the tolerance negative
  // for negative metrics, so every run would look "changed".
  const avgMagnitude = Math.abs((currentValue + previousValue) / 2)
  const toleranceAmount = (config.tolerance_percent / 100) * avgMagnitude
  const changedSignificantly = diff > toleranceAmount

  if (changedSignificantly) {
    return {
      shouldFire: false,
      reason: `${metricKey} changed from ${previousValue} to ${currentValue}`,
      changed: true,
      nextState: { previous_value: currentValue, consecutive_count: 1, last_changed_at: now },
    }
  }

  const nextCount = consecutiveCount + 1
  const shouldFire = nextCount >= config.consecutive_runs

  return {
    shouldFire,
    changed: false,
    reason: shouldFire
      ? `${metricKey} has not changed for ${nextCount} consecutive runs (threshold: ${config.consecutive_runs})`
      : `${metricKey} unchanged (${nextCount}/${config.consecutive_runs} runs)`,
    nextState: { consecutive_count: shouldFire ? config.consecutive_runs : nextCount },
  }
}
