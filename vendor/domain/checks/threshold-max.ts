/**
 * Threshold-max check evaluator.
 * Fires when a metric exceeds a maximum value.
 * Symmetric complement to threshold-min; intended for inverse counters
 * (error_count, unassigned_count) and diagnostic gauges (memory_used_mb).
 */

import type { ThresholdMaxCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface ThresholdMaxEvalInput {
  config: ThresholdMaxCheckConfig
  currentValue: number | null
}

export function evaluateThresholdMax(input: ThresholdMaxEvalInput): CheckEvalResult {
  const { config, currentValue } = input

  if (currentValue === null) {
    return { shouldFire: false, reason: 'No metric value available' }
  }

  if (currentValue > config.threshold_max) {
    return {
      shouldFire: true,
      reason: `${config.metric_key} (${currentValue}) exceeds maximum (${config.threshold_max})`,
    }
  }

  return { shouldFire: false }
}
