/** Shared result shape for a single check evaluation. */
export interface CheckEvalResult {
  shouldFire: boolean
  reason?: string
  nextExpectedAt?: string
}
