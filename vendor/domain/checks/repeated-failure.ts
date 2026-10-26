/**
 * Repeated-failure check evaluator.
 * Fires when failure count exceeds threshold within a rolling window.
 */

import type { RepeatedFailureCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface RepeatedFailureEvalInput {
  config: RepeatedFailureCheckConfig
  failureCount: number
  windowStart: string
  now: string
}

export function evaluateRepeatedFailure(input: RepeatedFailureEvalInput): CheckEvalResult {
  const { config, failureCount } = input

  if (failureCount >= config.failure_count_threshold) {
    return {
      shouldFire: true,
      reason: `${failureCount} failures in ${config.window_minutes}-minute window (threshold: ${config.failure_count_threshold})`,
    }
  }

  return { shouldFire: false }
}
