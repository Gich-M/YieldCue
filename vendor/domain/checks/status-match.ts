/**
 * Status-match check evaluator.
 * Fires when a string field in the payload matches a configured failure value.
 * Intended for single-event failure states (e.g. import_state=FAILED) where
 * repeated_failure would be semantically wrong.
 */

import type { StatusMatchCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface StatusMatchEvalInput {
  config: StatusMatchCheckConfig
  /**
   * Raw value at field_path. Null/undefined means absent; any other value is a
   * present value. A present non-string cannot satisfy the string contract and
   * is treated as a mismatch (fires).
   */
  fieldValue: unknown
}

export function evaluateStatusMatch(input: StatusMatchEvalInput): CheckEvalResult {
  const { config, fieldValue } = input

  if (fieldValue === null || fieldValue === undefined) {
    return { shouldFire: false, reason: `Field '${config.field_path}' not present in payload` }
  }

  if (typeof fieldValue !== 'string') {
    return {
      shouldFire: true,
      reason: `${config.field_path} is not a string (failure value: '${config.failure_value}')`,
    }
  }

  const matches = config.match_mode === 'prefix'
    ? fieldValue.startsWith(config.failure_value)
    : fieldValue === config.failure_value

  if (matches) {
    return {
      shouldFire: true,
      reason: `${config.field_path} is '${fieldValue}' (failure value: '${config.failure_value}')`,
    }
  }

  return { shouldFire: false }
}
