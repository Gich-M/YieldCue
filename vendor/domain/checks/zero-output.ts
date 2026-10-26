/**
 * Zero-output check evaluator.
 * Fires when the configured metric resolves to zero for a signal event.
 */

import type { ZeroOutputCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface ZeroOutputEvalInput {
  config: ZeroOutputCheckConfig
  metricKey: string
  currentValue: number | null
}

export function evaluateZeroOutput(input: ZeroOutputEvalInput): CheckEvalResult {
  const { config, metricKey, currentValue } = input

  if (currentValue === null) {
    return {
      shouldFire: false,
      reason: `No ${metricKey} metric available`,
    }
  }

  if (currentValue === 0 && !config.allowed_zero) {
    return {
      shouldFire: true,
      reason: `${metricKey} resolved to zero`,
    }
  }

  return { shouldFire: false }
}
