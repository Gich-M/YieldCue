/**
 * Public ingest handler (§8.6, §8.7). Validates and normalizes one typed
 * event, evaluates it synchronously, and commits the event plus its incident
 * and delivery side-effects in a single SQLite transaction.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Context } from 'hono'
import type { Check, CheckStateSnapshot, Event, EventType } from '@yieldcue/contracts'
import { evaluateEvent } from '@yieldcue/domain'
import {
  CLIENT_TENANT_ID,
  checkRowToDomain,
  eventRowToDomain,
  incidentRowToDomain,
  parseJson,
} from './db/types.ts'
import { getWorkflowByKey } from './db/workflows.ts'
import {
  getEventByWorkflowAndKey,
  insertEvent,
  listWorkflowEvents,
} from './db/events.ts'
import { listChecks } from './db/checks.ts'
import { listIncidents } from './db/incidents.ts'
import { getCheckState } from './db/check-state.ts'
import { applyActions } from './engine/apply-actions.ts'
import { processDueDeliveries } from './engine/process-deliveries.ts'

const MAX_BODY_BYTES = 16 * 1024
const MAX_METRIC_KEYS = 16
const MAX_CONTEXT_DEPTH = 3
const MAX_KEY_BYTES = 128
const DAY_MS = 86_400_000

const EVENT_TYPES = new Set(['heartbeat', 'signal'])
const EVENT_STATUSES = new Set(['ok', 'warn', 'error'])
const TOP_LEVEL_FIELDS = new Set([
  'event_type',
  'workflow_key',
  'client_key',
  'idempotency_key',
  'provider_run_id',
  'occurred_at',
  'status',
  'metrics',
  'context',
  'is_test',
  'ingest_version',
])

interface ValidationError {
  code: string
  message: string
  details?: Record<string, unknown>
}

type NormalizeResult =
  | {
      ok: true
      payload: Record<string, unknown>
      event_type: EventType
      is_test: boolean
      idempotency_key: string | null
      truncated: boolean
    }
  | { ok: false; error: ValidationError }

function fail(code: string, message: string, details?: Record<string, unknown>): NormalizeResult {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } }
}

/** Deterministic stringify (sorted keys) for canonical idempotency comparison. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function compactContext(
  value: unknown,
  depth = 0
): { value: unknown; truncated: boolean } {
  if (value === null || typeof value !== 'object') {
    return { value, truncated: false }
  }
  if (depth >= MAX_CONTEXT_DEPTH) {
    return { value: '[truncated]', truncated: true }
  }
  if (Array.isArray(value)) {
    let truncated = false
    const out: unknown[] = []
    for (const item of value) {
      const r = compactContext(item, depth + 1)
      out.push(r.value)
      truncated = truncated || r.truncated
    }
    return { value: out, truncated }
  }
  let truncated = false
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const r = compactContext(v, depth + 1)
    out[k] = r.value
    truncated = truncated || r.truncated
  }
  return { value: out, truncated }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function normalize(raw: Record<string, unknown>): NormalizeResult {
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      return fail('validation_error', `Unknown field: ${key}`, { field: key })
    }
  }

  if (raw.ingest_version !== 1) {
    return fail('validation_error', 'ingest_version must be 1')
  }

  if (typeof raw.event_type !== 'string' || !EVENT_TYPES.has(raw.event_type)) {
    return fail('validation_error', 'event_type must be heartbeat or signal')
  }
  const eventType = raw.event_type as EventType

  if (typeof raw.workflow_key !== 'string' || raw.workflow_key.length === 0) {
    return fail('validation_error', 'workflow_key is required')
  }
  if (Buffer.byteLength(raw.workflow_key, 'utf8') > MAX_KEY_BYTES) {
    return fail('validation_error', 'workflow_key exceeds 128 bytes')
  }

  if (!isValidTimestamp(raw.occurred_at)) {
    return fail('validation_error', 'occurred_at must be an ISO-8601 timestamp')
  }

  const isTest = raw.is_test === undefined ? false : raw.is_test
  if (typeof isTest !== 'boolean') {
    return fail('validation_error', 'is_test must be a boolean')
  }

  if (raw.status !== undefined && !EVENT_STATUSES.has(raw.status as string)) {
    return fail('validation_error', 'status must be ok, warn, or error')
  }

  if (!isPlainObject(raw.context)) {
    return fail('validation_error', 'context is required and must be an object')
  }
  if (eventType === 'signal' && raw.status === undefined) {
    return fail('validation_error', 'signal events require status')
  }

  const idempotencyKey = raw.idempotency_key ?? null
  if (idempotencyKey !== null && typeof idempotencyKey !== 'string') {
    return fail('validation_error', 'idempotency_key must be a string')
  }
  if (
    eventType === 'signal' &&
    (idempotencyKey === null || idempotencyKey.length === 0)
  ) {
    return fail('validation_error', 'signal events require idempotency_key')
  }
  if (idempotencyKey !== null && Buffer.byteLength(idempotencyKey, 'utf8') > MAX_KEY_BYTES) {
    return fail('validation_error', 'idempotency_key exceeds 128 bytes')
  }

  if (raw.client_key !== undefined) {
    if (typeof raw.client_key !== 'string') {
      return fail('validation_error', 'client_key must be a string')
    }
    if (Buffer.byteLength(raw.client_key, 'utf8') > MAX_KEY_BYTES) {
      return fail('validation_error', 'client_key exceeds 128 bytes')
    }
  }

  let truncated = false
  let metrics: Record<string, unknown> | undefined
  if (raw.metrics !== undefined) {
    if (!isPlainObject(raw.metrics)) {
      return fail('validation_error', 'metrics must be an object')
    }
    metrics = raw.metrics
    const keys = Object.keys(metrics)
    if (keys.length > MAX_METRIC_KEYS) {
      const kept: Record<string, unknown> = {}
      for (const k of keys.slice(0, MAX_METRIC_KEYS)) kept[k] = metrics[k]
      metrics = kept
      truncated = true
    }
    for (const k of Object.keys(metrics)) {
      if (typeof metrics[k] !== 'number') {
        return fail('validation_error', `metrics.${k} must be a number`)
      }
    }
  }

  const compactedContext = compactContext(raw.context)
  truncated = truncated || compactedContext.truncated

  const payload: Record<string, unknown> = {
    event_type: eventType,
    workflow_key: raw.workflow_key,
    occurred_at: raw.occurred_at,
    status: raw.status,
    context: compactedContext.value,
    ingest_version: 1,
    is_test: isTest,
  }
  if (raw.client_key !== undefined) payload.client_key = raw.client_key
  if (raw.idempotency_key !== undefined) payload.idempotency_key = raw.idempotency_key
  if (raw.provider_run_id !== undefined) payload.provider_run_id = raw.provider_run_id
  if (metrics !== undefined) payload.metrics = metrics

  return {
    ok: true,
    payload,
    event_type: eventType,
    is_test: isTest,
    idempotency_key: idempotencyKey,
    truncated,
  }
}

function errorBody(
  c: Context,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): Response {
  return c.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    status as 400 | 404 | 409
  )
}

/**
 * Resolves an already-persisted idempotency key to its ingest response, or
 * null when no such event exists. Used for the pre-check and to recover when
 * a concurrent request wins the insert race instead of surfacing a 500.
 */
function idempotencyResponse(
  c: Context,
  db: DatabaseSync,
  workflowId: string,
  idempotencyKey: string,
  canonical: string
): Response | null {
  const existing = getEventByWorkflowAndKey(db, workflowId, idempotencyKey)
  if (!existing) return null
  if (stableStringify(parseJson(existing.payload)) === canonical) {
    return c.json(
      {
        data: { event_id: existing.id, accepted: true, duplicate: true },
        meta: { received_at: existing.received_at, truncated: false },
      },
      202
    )
  }
  return errorBody(
    c,
    409,
    'idempotency_conflict',
    'idempotency_key reused with different fields',
    { original_event_id: existing.id }
  )
}

export async function handleIngest(c: Context, db: DatabaseSync): Promise<Response> {
  // Reject obviously oversized bodies before buffering them. The post-read
  // check below remains the authority for chunked bodies or a lying header.
  const contentLength = Number(c.req.header('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return errorBody(c, 400, 'validation_error', 'Request body exceeds 16 KB')
  }

  const rawText = await c.req.text()
  if (Buffer.byteLength(rawText, 'utf8') > MAX_BODY_BYTES) {
    return errorBody(c, 400, 'validation_error', 'Request body exceeds 16 KB')
  }

  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    return errorBody(c, 400, 'validation_error', 'Request body is not valid JSON')
  }
  if (!isPlainObject(raw)) {
    return errorBody(c, 400, 'validation_error', 'Request body must be a JSON object')
  }

  const normalized = normalize(raw)
  if (!normalized.ok) {
    return errorBody(
      c,
      400,
      normalized.error.code,
      normalized.error.message,
      normalized.error.details
    )
  }

  const workflow = getWorkflowByKey(db, normalized.payload.workflow_key as string)
  if (!workflow) {
    return errorBody(c, 404, 'unknown_workflow', 'Unknown workflow_key')
  }

  const now = new Date().toISOString()
  const canonical = stableStringify(normalized.payload)

  if (normalized.idempotency_key !== null) {
    const existingResponse = idempotencyResponse(
      c,
      db,
      workflow.id,
      normalized.idempotency_key,
      canonical
    )
    if (existingResponse) return existingResponse
  }

  const event: Event = {
    id: randomUUID(),
    tenant_id: CLIENT_TENANT_ID,
    workflow_id: workflow.id,
    client_id: null,
    event_type: normalized.event_type,
    is_test: normalized.is_test,
    payload: normalized.payload,
    idempotency_key: normalized.idempotency_key,
    source_ip: null,
    received_at: now,
  }

  const actions = normalized.is_test
    ? []
    : await evaluateEvent(buildContext(db, workflow.id, event, now))

  db.exec('BEGIN')
  try {
    insertEvent(db, {
      id: event.id,
      workflow_id: event.workflow_id,
      event_type: event.event_type,
      payload: event.payload,
      idempotency_key: event.idempotency_key,
      received_at: event.received_at,
      is_test: event.is_test,
    })
    applyActions(db, actions, { workflowName: workflow.name, now })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    // A concurrent request with the same idempotency_key can win the insert
    // race between the pre-check and commit. Resolve against the now-committed
    // row instead of surfacing a 500.
    if (normalized.idempotency_key !== null) {
      const existingResponse = idempotencyResponse(
        c,
        db,
        workflow.id,
        normalized.idempotency_key,
        canonical
      )
      if (existingResponse) return existingResponse
    }
    throw error
  }

  // Delivery is attempted after commit; the response does not wait on it.
  processDueDeliveries(db).catch((error) =>
    console.error('Delivery processing failed:', error)
  )

  return c.json(
    {
      data: { event_id: event.id, accepted: true, duplicate: false },
      meta: { received_at: now, truncated: normalized.truncated },
    },
    202
  )
}

/**
 * The widest lookback any enabled check needs. Baseline checks read up to
 * `lookback_days`, repeated-failure up to `window_minutes`; every other check
 * type reads only the current event. Bounding the window keeps ingest cost
 * flat as a workflow's history grows instead of loading it all per event.
 */
function historyWindow(checks: Check[], now: string): { since?: string } {
  let maxMs = 0
  for (const check of checks) {
    if (!check.is_enabled) continue
    if (check.check_type === 'baseline_drop' || check.check_type === 'baseline_spike') {
      maxMs = Math.max(maxMs, check.config.lookback_days * DAY_MS)
    } else if (check.check_type === 'repeated_failure') {
      maxMs = Math.max(maxMs, check.config.window_minutes * 60_000)
    }
  }
  return maxMs > 0 ? { since: new Date(Date.parse(now) - maxMs).toISOString() } : {}
}

function buildContext(
  db: DatabaseSync,
  workflowId: string,
  event: Event,
  now: string
) {
  const checks = listChecks(db, workflowId).map(checkRowToDomain)
  const existingIncidents = new Map(
    listIncidents(db, { workflow_id: workflowId }).map((row) => [
      row.fingerprint,
      incidentRowToDomain(row),
    ])
  )
  const checkStates = new Map<string, CheckStateSnapshot>()
  for (const check of checks) {
    const state = getCheckState(db, check.id)
    if (state) {
      checkStates.set(check.id, {
        state_data: parseJson(state.state_data),
        consecutive_failures: state.consecutive_failures,
        last_evaluated_at: state.last_evaluated_at ?? undefined,
      })
    }
  }
  const workflowEvents = listWorkflowEvents(db, workflowId, historyWindow(checks, now))
    .map(eventRowToDomain)
    .filter((e) => !e.is_test)

  return { event, checks, now, existingIncidents, workflowEvents, checkStates }
}
