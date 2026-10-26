/**
 * Baseline-spike check evaluator.
 * Fires when a metric rises by X% above its historical baseline.
 * Symmetric complement to baseline-drop.
 */

import type { BaselineSpikeCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface BaselineSpikeEvalInput {
  config: BaselineSpikeCheckConfig
  currentValue: number | null
  baselineValue: number | null
  dataPointCount: number
}

export function evaluateBaselineSpike(input: BaselineSpikeEvalInput): CheckEvalResult {
  const { config, currentValue, baselineValue, dataPointCount } = input

  // Cold-start: skip if not enough data
  if (dataPointCount < config.min_sample_count) {
    return { shouldFire: false, reason: `Insufficient data points (${dataPointCount}/${config.min_sample_count})` }
  }

  if (currentValue === null || baselineValue === null || baselineValue === 0) {
    return { shouldFire: false }
  }

  const spikePercent = ((currentValue - baselineValue) / baselineValue) * 100

  if (spikePercent > config.spike_percent) {
    return {
      shouldFire: true,
      reason: `${config.metric_key} spiked ${spikePercent.toFixed(1)}% above baseline (threshold: ${config.spike_percent}%)`,
    }
  }

  return { shouldFire: false }
}
