/**
 * Check-type metadata and type-specific config form rendering/parsing.
 * The eleven check types mirror the contracts `CheckConfigByType` shapes.
 */

import type { CheckType } from '@yieldcue/contracts'
import { escapeHtml } from './layout.ts'
import { renderHtml } from './templates.ts'

export const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  heartbeat: 'Heartbeat',
  zero_output: 'Zero output',
  threshold_min: 'Threshold (min)',
  threshold_max: 'Threshold (max)',
  baseline_drop: 'Baseline drop',
  baseline_spike: 'Baseline spike',
  status_match: 'Status match',
  expected_value: 'Expected value',
  repeated_failure: 'Repeated failure',
  data_freshness: 'Data freshness',
  no_change: 'No change',
}

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'bool' | 'select'
  options?: [value: string, label: string][]
  hint?: string
  step?: string
}

const FIELDS: Record<CheckType, FieldDef[]> = {
  heartbeat: [
    { key: 'interval_minutes', label: 'Interval (minutes)', type: 'number', hint: 'Expected cadence between heartbeats.' },
    { key: 'grace_minutes', label: 'Grace (minutes)', type: 'number', hint: 'Allowed lateness before the workflow is considered overdue.' },
  ],
  zero_output: [
    { key: 'metric_key', label: 'Metric key', type: 'text', hint: 'Signal metric key to evaluate.' },
    { key: 'allowed_zero', label: 'Zero is healthy', type: 'bool' },
  ],
  threshold_min: [
    { key: 'metric_key', label: 'Metric key', type: 'text' },
    { key: 'threshold_min', label: 'Minimum threshold', type: 'number', step: 'any' },
  ],
  threshold_max: [
    { key: 'metric_key', label: 'Metric key', type: 'text' },
    { key: 'threshold_max', label: 'Maximum threshold', type: 'number', step: 'any' },
  ],
  baseline_drop: [
    { key: 'metric_key', label: 'Metric key', type: 'text' },
    { key: 'drop_percent', label: 'Drop percent', type: 'number', step: 'any' },
    { key: 'lookback_days', label: 'Lookback (days)', type: 'number' },
    { key: 'min_sample_count', label: 'Minimum samples', type: 'number' },
  ],
  baseline_spike: [
    { key: 'metric_key', label: 'Metric key', type: 'text' },
    { key: 'spike_percent', label: 'Spike percent', type: 'number', step: 'any' },
    { key: 'lookback_days', label: 'Lookback (days)', type: 'number' },
    { key: 'min_sample_count', label: 'Minimum samples', type: 'number' },
  ],
  status_match: [
    { key: 'field_path', label: 'Field path', type: 'text', hint: 'Dot-notation path in the signal context, e.g. import_state.' },
    { key: 'failure_value', label: 'Failure value', type: 'text' },
    { key: 'match_mode', label: 'Match mode', type: 'select', options: [['exact', 'Exact'], ['prefix', 'Prefix']] },
  ],
  expected_value: [
    { key: 'field_path', label: 'Field path', type: 'text' },
    { key: 'field_type', label: 'Field type', type: 'select', options: [['string', 'String'], ['boolean', 'Boolean']] },
    { key: 'expected_value', label: 'Expected value', type: 'text' },
  ],
  repeated_failure: [
    { key: 'window_minutes', label: 'Window (minutes)', type: 'number' },
    { key: 'failure_count_threshold', label: 'Failure count threshold', type: 'number' },
  ],
  data_freshness: [
    { key: 'field_path', label: 'Field path', type: 'text', hint: 'Dot-notation path to the timestamp in the signal context.' },
    { key: 'max_staleness_hours', label: 'Max staleness (hours)', type: 'number', step: 'any' },
  ],
  no_change: [
    { key: 'metric_key', label: 'Metric key', type: 'text' },
    { key: 'consecutive_runs', label: 'Consecutive runs', type: 'number' },
    { key: 'tolerance_percent', label: 'Tolerance percent', type: 'number', step: 'any' },
  ],
}

function fieldValue(config: Record<string, unknown>, key: string): string {
  const value = config[key]
  if (value === undefined || value === null) return ''
  return String(value)
}

export function renderConfigFields(
  checkType: CheckType,
  config: Record<string, unknown>
): string {
  const fields = FIELDS[checkType] ?? []
  return fields
    .map((field) => {
      const name = `config.${field.key}`
      const value = fieldValue(config, field.key)
      const hint = field.hint ? renderHtml('config-hint.html', { hint: escapeHtml(field.hint) }) : ''
      if (field.type === 'bool') {
        const checked = config[field.key] === true ? ' checked' : ''
        return renderHtml('config-checkbox-field.html', {
          key: escapeHtml(field.key),
          name: escapeHtml(name),
          checked,
          label: escapeHtml(field.label),
        })
      }
      if (field.type === 'select') {
        const options = (field.options ?? [])
          .map(
            ([optionValue, label]) =>
              renderHtml('option.html', {
                value: escapeHtml(optionValue),
                selected: optionValue === value ? ' selected' : '',
                label: escapeHtml(label),
              })
          )
          .join('')
        return renderHtml('config-select-field.html', {
          key: escapeHtml(field.key),
          name: escapeHtml(name),
          label: escapeHtml(field.label),
          options,
          hint,
        })
      }
      const inputType = field.type === 'number' ? 'number' : 'text'
      const step = field.step ? ` step="${escapeHtml(field.step)}"` : ''
      return renderHtml('config-input-field.html', {
        key: escapeHtml(field.key),
        type: inputType,
        name: escapeHtml(name),
        value: escapeHtml(value),
        step,
        hint,
        label: escapeHtml(field.label),
      })
    })
    .join('')
}

/** Parses form fields into the canonical config object for a check type. */
export function parseConfig(
  checkType: CheckType,
  form: Record<string, string>
): Record<string, unknown> {
  const fields = FIELDS[checkType] ?? []
  const config: Record<string, unknown> = {}

  for (const field of fields) {
    const raw = form[`config.${field.key}`]
    if (field.type === 'bool') {
      config[field.key] = raw === 'on' || raw === 'true'
    } else if (field.type === 'number') {
      const num = Number(raw)
      config[field.key] = Number.isNaN(num) ? 0 : num
    } else if (field.key === 'expected_value' && form['config.field_type'] === 'boolean') {
      config[field.key] = raw === 'true'
    } else {
      config[field.key] = raw ?? ''
    }
  }

  // A few fields need string coercion for exact contract typing.
  if (checkType === 'zero_output') {
    config.metric_key = String(config.metric_key ?? '')
  }
  if (checkType === 'expected_value') {
    config.field_path = String(config.field_path ?? '')
  }

  return config
}

export const CHECK_TYPES = Object.keys(CHECK_TYPE_LABELS) as CheckType[]

/** Compact human summary of a check's config for list views. */
export function summarizeConfig(
  checkType: CheckType,
  config: Record<string, unknown>
): string {
  switch (checkType) {
    case 'heartbeat':
      return `every ${config.interval_minutes}m, ${config.grace_minutes}m grace`
    case 'zero_output':
      return `${config.metric_key} zero is ${config.allowed_zero ? 'healthy' : 'unhealthy'}`
    case 'threshold_min':
      return `${config.metric_key} ≥ ${config.threshold_min}`
    case 'threshold_max':
      return `${config.metric_key} ≤ ${config.threshold_max}`
    case 'baseline_drop':
      return `${config.metric_key} drops ${config.drop_percent}%`
    case 'baseline_spike':
      return `${config.metric_key} spikes ${config.spike_percent}%`
    case 'status_match':
      return `${config.field_path} matches "${config.failure_value}"`
    case 'expected_value':
      return `${config.field_path} equals ${config.expected_value}`
    case 'repeated_failure':
      return `${config.failure_count_threshold} failures in ${config.window_minutes}m`
    case 'data_freshness':
      return `${config.field_path} stale after ${config.max_staleness_hours}h`
    case 'no_change':
      return `${config.metric_key} unchanged for ${config.consecutive_runs} runs`
    default:
      return ''
  }
}
