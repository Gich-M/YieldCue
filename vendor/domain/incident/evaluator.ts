import { evaluateBaselineDrop } from '../checks/baseline-drop.ts'
import { evaluateBaselineSpike } from '../checks/baseline-spike.ts'
import { evaluateDataFreshness } from '../checks/data-freshness.ts'
import { evaluateExpectedValue } from '../checks/expected-value.ts'
import { evaluateNoChange } from '../checks/no-change.ts'
import { evaluateRepeatedFailure } from '../checks/repeated-failure.ts'
import { evaluateStatusMatch } from '../checks/status-match.ts'
import { evaluateThresholdMax } from '../checks/threshold-max.ts'
import { evaluateThresholdMin } from '../checks/threshold-min.ts'
import { evaluateZeroOutput } from '../checks/zero-output.ts'
import { computeFingerprint } from './fingerprint.ts'
import { pushOutcomeAction } from './evaluator-actions.ts'
import {
  getContext,
  getEventTimestamp,
  getFailureCount,
  getHistoricalMetricValues,
  getMetrics,
  getPayload,
  getWorkflowEvents,
  meanOrNull,
  readFieldByPath,
  readNumericMetric,
} from './evaluator-events.ts'
import type { EvaluationAction, EvaluationContext } from '@yieldcue/contracts/evaluator.ts'

export type { EvaluationAction, EvaluationContext } from '@yieldcue/contracts/evaluator.ts'

/** Evaluates a single event against the tenant's enabled checks, returning incident actions. */
export async function evaluateEvent(ctx: EvaluationContext): Promise<EvaluationAction[]> {
  const { event, checks, now, existingIncidents, evaluatedPairs } = ctx
  const actions: EvaluationAction[] = []
  const payload = getPayload(event)
  const metrics = getMetrics(payload)
  const context = getContext(payload)
  const workflowEvents = getWorkflowEvents(ctx)

  for (const check of checks) {
    if (!check.is_enabled) {
      continue
    }

    const evalKey = `${event.id}::${check.id}`
    if (evaluatedPairs?.has(evalKey)) {
      continue
    }

    const fingerprint = await computeFingerprint({
      tenantId: event.tenant_id,
      workflowId: event.workflow_id,
      checkId: check.id,
    })

    const existing = existingIncidents?.get(fingerprint)

    if (check.check_type === 'heartbeat') {
      // C9: only a heartbeat resolves a heartbeat check. A signal proves the
      // workflow reached YieldCue, but it is not the health signal this check owns.
      if (event.event_type === 'heartbeat') {
        actions.push({
          type: existing?.status === 'ignored' ? 'mark_ignored_cleared' : 'resolve_incident',
          fingerprint,
          checkId: check.id,
          reason: 'Heartbeat received',
        })
      }
      continue
    }

    if (event.event_type !== 'signal') {
      continue
    }

    switch (check.check_type) {
      case 'zero_output': {
        const config = check.config
        const currentValue = readNumericMetric(metrics, config.metric_key)
        const result = evaluateZeroOutput({ config, metricKey: config.metric_key, currentValue })

        pushOutcomeAction(actions, event, check, existing, fingerprint, result, now, currentValue !== null)
        break
      }

      case 'threshold_min': {
        const config = check.config
        const currentValue = readNumericMetric(metrics, config.metric_key)
        const result = evaluateThresholdMin({ config, currentValue })

        pushOutcomeAction(actions, event, check, existing, fingerprint, result, now, currentValue !== null)
        break
      }

      case 'baseline_drop': {
        const config = check.config
        const currentValue = readNumericMetric(metrics, config.metric_key)
        const historicalValues = getHistoricalMetricValues(
          workflowEvents,
          event,
          config.metric_key,
          config.lookback_days
        )
        const baselineValue = meanOrNull(historicalValues)
        const dataPointCount = historicalValues.length

        const result = evaluateBaselineDrop({ config, currentValue, baselineValue, dataPointCount })

        pushOutcomeAction(
          actions, event, check, existing, fingerprint, result, now,
          currentValue !== null && dataPointCount >= config.min_sample_count
        )
        break
      }

      case 'threshold_max': {
        const config = check.config
        const currentValue = readNumericMetric(metrics, config.metric_key)
        const result = evaluateThresholdMax({ config, currentValue })

        pushOutcomeAction(actions, event, check, existing, fingerprint, result, now, currentValue !== null)
        break
      }

      case 'baseline_spike': {
        const config = check.config
        const currentValue = readNumericMetric(metrics, config.metric_key)
        const historicalValues = getHistoricalMetricValues(
          workflowEvents,
          event,
          config.metric_key,
          config.lookback_days
        )
        const baselineValue = meanOrNull(historicalValues)
        const dataPointCount = historicalValues.length

        const result = evaluateBaselineSpike({ config, currentValue, baselineValue, dataPointCount })

        pushOutcomeAction(
          actions, event, check, existing, fingerprint, result, now,
          currentValue !== null && dataPointCount >= config.min_sample_count
        )
        break
      }

      case 'status_match': {
        const config = check.config
        // A present value of the wrong type is a mismatch and fires (M3); only a
        // present string can support automatic resolution.
        const fieldValue = readFieldByPath(context, config.field_path)
        const result = evaluateStatusMatch({ config, fieldValue })

        pushOutcomeAction(actions, event, check, existing, fingerprint, result, now, typeof fieldValue === 'string')
        break
      }

      case 'expected_value': {
        const config = check.config
        // A present value of the wrong type differs from expected_value and fires (M3).
        const fieldValue = readFieldByPath(context, config.field_path)
        const result = evaluateExpectedValue({ config, fieldValue })
        const canResolve = typeof fieldValue === 'string' || typeof fieldValue === 'boolean'

        pushOutcomeAction(actions, event, check, existing, fingerprint, result, now, canResolve)
        break
      }

      case 'data_freshness': {
        const config = check.config
        const timestampValue = readFieldByPath(context, config.field_path)
        const result = evaluateDataFreshness({ config, timestampValue, receivedAt: event.received_at })

        pushOutcomeAction(actions, event, check, existing, fingerprint, result, now, result.canResolve)
        break
      }

      case 'repeated_failure': {
        const config = check.config
        const failureCount = getFailureCount(workflowEvents, event, config.window_minutes)
        const windowStart = new Date(
          getEventTimestamp(event) - (config.window_minutes * 60_000)
        ).toISOString()
        const result = evaluateRepeatedFailure({ config, failureCount, windowStart, now })

        pushOutcomeAction(actions, event, check, existing, fingerprint, result, now, true)
        break
      }

      case 'no_change': {
        const config = check.config
        const currentValue = readNumericMetric(metrics, config.metric_key)
        const stateData = ctx.checkStates?.get(check.id)?.state_data as Record<string, unknown> | undefined
        const previousValue = typeof stateData?.previous_value === 'number' ? stateData.previous_value : null
        const consecutiveCount = typeof stateData?.consecutive_count === 'number' ? stateData.consecutive_count : 0

        const result = evaluateNoChange({
          config,
          metricKey: config.metric_key,
          currentValue,
          previousValue,
          consecutiveCount,
          now,
        })

        if (result.nextState) {
          actions.push({
            type: 'update_check_state',
            checkId: check.id,
            stateData: { ...stateData, ...result.nextState },
          })
        }

        pushOutcomeAction(actions, event, check, existing, fingerprint, result, now, result.changed)
        break
      }

      default: {
        // Exhaustiveness guard: adding a check type without handling it fails to compile.
        const unhandled: never = check
        throw new Error(`Unhandled check type: ${String((unhandled as { check_type: unknown }).check_type)}`)
      }
    }
  }

  return actions
}
