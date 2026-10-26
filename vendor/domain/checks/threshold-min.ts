/**
 * Threshold-min check evaluator.
 * Fires when a metric drops below a minimum value.
 */

import type { ThresholdMinCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface ThresholdMinEvalInput {
  config: ThresholdMinCheckConfig
  currentValue: number | null
}

export function evaluateThresholdMin(input: ThresholdMinEvalInput): CheckEvalResult {
  const { config, currentValue } = input

  if (currentValue === null) {
    return { shouldFire: false, reason: 'No metric value available' }
  }

  if (currentValue < config.threshold_min) {
    return {
      shouldFire: true,
      reason: `${config.metric_key} (${currentValue}) is below minimum (${config.threshold_min})`,
    }
  }

  return { shouldFire: false }
}
