/**
 * Expected-value check evaluator.
 * Fires when a boolean or string field does not equal the expected value.
 * Intended for flag fields (e.g. is_partial: false must always be false)
 * and string sentinels.
 */

import type { ExpectedValueCheckConfig } from '@yieldcue/contracts'
import type { CheckEvalResult } from './types.ts'

export interface ExpectedValueEvalInput {
  config: ExpectedValueCheckConfig
  /**
   * Raw value at field_path. Null/undefined means absent; any other value is a
   * present value. A present value whose runtime type differs from the declared
   * `field_type` is a mismatch and fires (TECHNICAL_SPEC.md §5.8).
   */
  fieldValue: unknown
}

export function evaluateExpectedValue(input: ExpectedValueEvalInput): CheckEvalResult {
  const { config, fieldValue } = input

  if (fieldValue === null || fieldValue === undefined) {
    return { shouldFire: false, reason: `Field '${config.field_path}' not present in payload` }
  }

  // A differing value fires under the declared field_type, including a type mismatch.
  if (config.field_type === 'boolean') {
    if (typeof fieldValue !== 'boolean') {
      return {
        shouldFire: true,
        reason: `${config.field_path} is not a boolean (expected ${config.expected_value})`,
      }
    }
    if (fieldValue !== config.expected_value) {
      return {
        shouldFire: true,
        reason: `${config.field_path} is ${fieldValue} (expected ${config.expected_value})`,
      }
    }
  } else {
    if (typeof fieldValue !== 'string') {
      return {
        shouldFire: true,
        reason: `${config.field_path} is not a string (expected '${config.expected_value}')`,
      }
    }
    if (fieldValue !== config.expected_value) {
      return {
        shouldFire: true,
        reason: `${config.field_path} is '${fieldValue}' (expected '${config.expected_value}')`,
      }
    }
  }

  return { shouldFire: false }
}
