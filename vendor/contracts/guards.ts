/**
 * Type guard utilities.
 * Single canonical implementation for the entire monorepo.
 */

/**
 * Narrows `unknown` to a JSON object record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
