/**
 * Baseline-drop check evaluator.
 * Fires when a metric drops by X% from its historical baseline.
 */

import type { BaselineDropCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface BaselineDropEvalInput {
  config: BaselineDropCheckConfig
  currentValue: number | null
  baselineValue: number | null
  dataPointCount: number
}

export function evaluateBaselineDrop(input: BaselineDropEvalInput): CheckEvalResult {
  const { config, currentValue, baselineValue, dataPointCount } = input

  // Cold-start: skip if not enough data
  if (dataPointCount < config.min_sample_count) {
    return { shouldFire: false, reason: `Insufficient data points (${dataPointCount}/${config.min_sample_count})` }
  }

  if (currentValue === null || baselineValue === null || baselineValue === 0) {
    return { shouldFire: false }
  }

  const dropPercent = ((baselineValue - currentValue) / baselineValue) * 100

  if (dropPercent > config.drop_percent) {
    return {
      shouldFire: true,
      reason: `${config.metric_key} dropped ${dropPercent.toFixed(1)}% from baseline (threshold: ${config.drop_percent}%)`,
    }
  }

  return { shouldFire: false }
}
