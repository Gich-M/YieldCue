/**
 * Client-local alert route matching.
 * Selects enabled alert routes for a workflow/severity pair, ordered by
 * specificity (§8.4).
 */
import type { Severity } from '@yieldcue/contracts'
import { parseJson, toBool, type AlertRouteRow } from '../db/types.ts'

export interface RouteMatchInput {
  workflowId: string
  severity: Severity
}

/**
 * Client-local alert route matcher. The client schema stores a single
 * `filter_workflow_id` and a JSON `filter_severity` array; it has no
 * client or check-type filters (§8.4).
 */
export function matchAlertRoutes(
  routes: AlertRouteRow[],
  input: RouteMatchInput
): AlertRouteRow[] {
  return routes
    .filter((route) => {
      if (!toBool(route.is_enabled)) return false

      const severities = parseJson<Severity[]>(route.filter_severity)
      if (severities.length > 0 && !severities.includes(input.severity)) {
        return false
      }
      if (route.filter_workflow_id && route.filter_workflow_id !== input.workflowId) {
        return false
      }
      return true
    })
    .sort((a, b) => specificity(b) - specificity(a))
}

function specificity(route: AlertRouteRow): number {
  return route.filter_workflow_id ? 1 : 0
}
