/**
 * Workflows list, workflow detail, and workflow-scoped check management.
 * Server-rendered HTML with HTMX boost; all state changes redirect with a
 * flash message.
 */

import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import type { CheckType, Severity } from '@yieldcue/contracts'
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  getWorkflowByKey,
  listWorkflows,
  updateWorkflow,
} from '../db/workflows.ts'
import {
  createCheck,
  deleteCheck,
  getCheck,
  listChecks,
  updateCheck,
} from '../db/checks.ts'
import { listIncidents } from '../db/incidents.ts'
import { listWorkflowEvents } from '../db/events.ts'
import {
  eventRowToDomain,
  parseJson,
  toBool,
  type CheckRow,
  type WorkflowRow,
} from '../db/types.ts'
import { chip, escapeHtml, fmtDateTime, pageShell } from './layout.ts'
import {
  CHECK_TYPES,
  CHECK_TYPE_LABELS,
  parseConfig,
  renderConfigFields,
  summarizeConfig,
} from './check-config.ts'
import { formBody, readFlash, redirectWithFlash } from './helpers.ts'

const STATUSES = ['active', 'paused', 'disabled'] as const
const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

function isValidStatus(value: string): value is (typeof STATUSES)[number] {
  return (STATUSES as readonly string[]).includes(value)
}

function isValidSeverity(value: string): value is Severity {
  return (SEVERITIES as string[]).includes(value)
}

function buildMetadata(body: Record<string, string>): Record<string, string> {
  const metadata: Record<string, string> = {}
  const provider = body['metadata.provider']?.trim()
  const environment = body['metadata.environment']?.trim()
  if (provider) metadata.provider = provider
  if (environment) metadata.environment = environment
  return metadata
}

function workflowFields(workflow?: WorkflowRow): string {
  const value = (key: string) =>
    workflow ? escapeHtml(String((parseJson(workflow.metadata) as Record<string, unknown>)[key] ?? '')) : ''
  return `
    <div class="form-row">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" type="text" name="name" value="${workflow ? escapeHtml(workflow.name) : ''}" required>
      </div>
      <div class="field">
        <label for="status">Status</label>
        <select id="status" name="status">
          ${STATUSES.map((s) => `<option value="${s}"${workflow?.status === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    ${
      workflow
        ? ''
        : `<div class="field">
            <label for="workflow_key">Workflow key</label>
            <input id="workflow_key" type="text" name="workflow_key" required>
            <div class="hint">Stable key senders use to target this workflow via the ingest endpoint.</div>
          </div>`
    }
    <div class="field">
      <label for="description">Description</label>
      <textarea id="description" name="description">${workflow ? escapeHtml(workflow.description) : ''}</textarea>
    </div>
    <div class="form-row">
      <div class="field">
        <label for="provider">Provider</label>
        <input id="provider" type="text" name="metadata.provider" value="${value('provider')}" placeholder="e.g. dbt, Airflow, cron">
      </div>
      <div class="field">
        <label for="environment">Environment</label>
        <input id="environment" type="text" name="metadata.environment" value="${value('environment')}" placeholder="e.g. production, staging">
      </div>
    </div>`
}

// --- Workflows list ---

function renderWorkflowList(rows: ReturnType<typeof listWorkflows>): string {
  if (rows.length === 0) {
    return `<div class="page-head">
        <h1>Workflows</h1>
        <a class="btn primary" href="/workflows/new">New workflow</a>
      </div>
      <div class="card"><div class="empty">No workflows yet. Create one to start receiving events.</div></div>`
  }

  const body = rows
    .map(
      (w) => `<tr>
        <td><a href="/workflows/${w.id}">${escapeHtml(w.name)}</a></td>
        <td><code>${escapeHtml(w.workflow_key)}</code></td>
        <td>${chip(w.status, w.status)}</td>
        <td>${w.check_count}</td>
        <td>${w.open_incident_count}</td>
        <td>${fmtDateTime(w.updated_at)}</td>
      </tr>`
    )
    .join('')

  return `<div class="page-head">
      <h1>Workflows</h1>
      <a class="btn primary" href="/workflows/new">New workflow</a>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Key</th><th>Status</th><th>Checks</th><th>Open</th><th>Updated</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`
}

// --- Workflow detail ---

function checkRowsHtml(workflowId: string, checks: CheckRow[]): string {
  if (checks.length === 0) {
    return `<div class="empty">No checks yet. Add one to start raising incidents.</div>`
  }
  return `<table>
    <thead><tr><th>Name</th><th>Type</th><th>Severity</th><th>Config</th><th></th></tr></thead>
    <tbody>${checks
      .map((check) => {
        const config = parseJson<Record<string, unknown>>(check.config)
        return `<tr>
          <td>${escapeHtml(check.name)}${toBool(check.is_enabled) ? '' : ' ' + chip('disabled', 'disabled')}</td>
          <td>${escapeHtml(CHECK_TYPE_LABELS[check.check_type])}</td>
          <td>${chip(check.severity, check.severity)}</td>
          <td class="small muted">${escapeHtml(summarizeConfig(check.check_type, config))}</td>
          <td class="actions">
            <a class="btn small" href="/workflows/${workflowId}/checks/${check.id}/edit">Edit</a>
            <form class="inline-form" method="post" action="/workflows/${workflowId}/checks/${check.id}/delete" hx-post="/workflows/${workflowId}/checks/${check.id}/delete" hx-confirm="Delete this check?">
              <button class="btn small danger" type="submit">Delete</button>
            </form>
          </td>
        </tr>`
      })
      .join('')}
    </tbody>
  </table>`
}

function renderWorkflowDetail(
  workflow: WorkflowRow,
  checks: CheckRow[],
  recentIncidents: ReturnType<typeof listIncidents>,
  recentEvents: ReturnType<typeof listWorkflowEvents>
): string {
  const metadata = parseJson<Record<string, unknown>>(workflow.metadata)
  const incidentsHtml = recentIncidents.length
    ? `<table>
        <thead><tr><th>Incident</th><th>Status</th><th>Severity</th><th>Opened</th></tr></thead>
        <tbody>${recentIncidents
          .map(
            (i) => `<tr>
              <td><a href="/incidents/${i.id}">${escapeHtml(i.title)}</a></td>
              <td>${chip(i.status, i.status)}</td>
              <td>${chip(i.severity, i.severity)}</td>
              <td>${fmtDateTime(i.opened_at)}</td>
            </tr>`
          )
          .join('')}
        </tbody>
      </table>`
    : `<div class="empty">No incidents for this workflow.</div>`

  const eventsHtml = recentEvents.length
    ? `<table>
        <thead><tr><th>Type</th><th>Status</th><th>Received</th><th></th></tr></thead>
        <tbody>${recentEvents
          .map((row) => {
            const e = eventRowToDomain(row)
            const status = (e.payload as { status?: string }).status
            return `<tr>
              <td>${escapeHtml(e.event_type)}</td>
              <td>${status ? chip(status, status === 'ok' ? 'resolved' : status === 'warn' ? 'warning' : 'critical') : '—'}</td>
              <td>${fmtDateTime(e.received_at)}</td>
              <td>${e.is_test ? chip('test', 'ignored') : ''}</td>
            </tr>`
          })
          .join('')}
        </tbody>
      </table>`
    : `<div class="empty">No events received yet.</div>`

  return `<div class="page-head">
      <div>
        <h1>${escapeHtml(workflow.name)} ${chip(workflow.status, workflow.status)}</h1>
        <div class="muted">${escapeHtml(workflow.description || 'No description')}</div>
      </div>
      <div class="actions">
        <a class="btn" href="/workflows/${workflow.id}/edit">Edit</a>
        <form class="inline-form" method="post" action="/workflows/${workflow.id}/delete" hx-post="/workflows/${workflow.id}/delete" hx-confirm="Delete this workflow and all of its checks, events, and incidents?">
          <button class="btn danger" type="submit">Delete</button>
        </form>
      </div>
    </div>

    <div class="card">
      <h2>Details</h2>
      <dl class="meta">
        <dt>Workflow key</dt><dd><code>${escapeHtml(workflow.workflow_key)}</code></dd>
        <dt>Provider</dt><dd>${escapeHtml(String(metadata.provider ?? '—'))}</dd>
        <dt>Environment</dt><dd>${escapeHtml(String(metadata.environment ?? '—'))}</dd>
        <dt>Created</dt><dd>${fmtDateTime(workflow.created_at)}</dd>
        <dt>Updated</dt><dd>${fmtDateTime(workflow.updated_at)}</dd>
      </dl>
    </div>

    <div class="card">
      <div class="card-head"><h2>Checks</h2><a class="btn primary small" href="/workflows/${workflow.id}/checks/new">New check</a></div>
      ${checkRowsHtml(workflow.id, checks)}
    </div>

    <div class="card">
      <div class="card-head"><h2>Recent incidents</h2><a class="btn small" href="/incidents?workflow=${workflow.id}">View all</a></div>
      ${incidentsHtml}
    </div>

    <div class="card">
      <div class="card-head"><h2>Recent events</h2></div>
      ${eventsHtml}
    </div>`
}

// --- Check form ---

function checkTypePicker(workflowId: string, selected: CheckType): string {
  return `<div class="actions" style="margin-bottom:1rem">${CHECK_TYPES.map(
    (t) =>
      `<a class="btn small${t === selected ? ' primary' : ''}" href="/workflows/${workflowId}/checks/new?type=${t}">${escapeHtml(CHECK_TYPE_LABELS[t])}</a>`
  ).join('')}</div>`
}

function checkFormFields(checkType: CheckType, check?: CheckRow): string {
  const config = check ? parseJson<Record<string, unknown>>(check.config) : {}
  const typeSelect = check
    ? `<p class="muted">Type: <strong>${escapeHtml(CHECK_TYPE_LABELS[check.check_type])}</strong></p>`
    : `<input type="hidden" name="check_type" value="${escapeHtml(checkType)}">`
  const severity = check?.severity ?? 'warning'
  const name = check?.name ?? ''

  return `
    ${typeSelect}
    <div class="form-row">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" type="text" name="name" value="${escapeHtml(name)}" required>
      </div>
      <div class="field">
        <label for="severity">Severity</label>
        <select id="severity" name="severity">
          ${SEVERITIES.map((s) => `<option value="${s}"${severity === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field checkbox-row">
      <input type="checkbox" id="is_enabled" name="is_enabled"${check ? (toBool(check.is_enabled) ? ' checked' : '') : ' checked'}>
      <label for="is_enabled">Enabled</label>
    </div>
    ${renderConfigFields(checkType, config)}`
}

// --- Handlers ---

export function mountWorkflows(app: Hono, db: DatabaseSync): void {
  const wf = new Hono()

  wf.get('/', (c) => {
    const content = renderWorkflowList(listWorkflows(db))
    return c.html(pageShell({ title: 'Workflows', active: 'workflows', content, flash: readFlash(c) }))
  })

  wf.get('/new', (c) => {
    const content = `<div class="page-head"><h1>New workflow</h1></div>
      <div class="card">
        <form method="post" action="/workflows">${workflowFields()}
          <div class="actions">
            <button class="btn primary" type="submit">Create workflow</button>
            <a class="btn" href="/workflows">Cancel</a>
          </div>
        </form>
      </div>`
    return c.html(pageShell({ title: 'New workflow', active: 'workflows', content }))
  })

  wf.post('/', async (c) => {
    const body = await formBody(c)
    const name = body.name?.trim()
    const workflowKey = body.workflow_key?.trim()
    if (!name || !workflowKey) {
      return redirectWithFlash(c, '/workflows/new', { kind: 'error', message: 'Name and workflow key are required.' })
    }
    if (getWorkflowByKey(db, workflowKey)) {
      return redirectWithFlash(c, '/workflows/new', { kind: 'error', message: 'That workflow key is already in use.' })
    }
    const row = createWorkflow(db, {
      name,
      workflow_key: workflowKey,
      description: body.description?.trim() ?? '',
      status: isValidStatus(body.status) ? body.status : 'active',
      metadata: buildMetadata(body),
    })
    return redirectWithFlash(c, `/workflows/${row.id}`, { kind: 'success', message: 'Workflow created.' })
  })

  wf.get('/:id', (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    if (!workflow) return c.text('Not found', 404)
    const content = renderWorkflowDetail(
      workflow,
      listChecks(db, workflow.id),
      listIncidents(db, { workflow_id: workflow.id, limit: 5 }),
      listWorkflowEvents(db, workflow.id, 20)
    )
    return c.html(pageShell({ title: workflow.name, active: 'workflows', content, flash: readFlash(c) }))
  })

  wf.get('/:id/edit', (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    if (!workflow) return c.text('Not found', 404)
    const content = `<div class="page-head"><h1>Edit workflow</h1></div>
      <div class="card">
        <form method="post" action="/workflows/${workflow.id}">${workflowFields(workflow)}
          <div class="actions">
            <button class="btn primary" type="submit">Save changes</button>
            <a class="btn" href="/workflows/${workflow.id}">Cancel</a>
          </div>
        </form>
      </div>`
    return c.html(pageShell({ title: `Edit ${workflow.name}`, active: 'workflows', content }))
  })

  wf.post('/:id', async (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    if (!workflow) return c.text('Not found', 404)
    const body = await formBody(c)
    const name = body.name?.trim()
    if (!name) {
      return redirectWithFlash(c, `/workflows/${workflow.id}/edit`, { kind: 'error', message: 'Name is required.' })
    }
    updateWorkflow(db, workflow.id, {
      name,
      description: body.description?.trim() ?? '',
      status: isValidStatus(body.status) ? body.status : 'active',
      metadata: buildMetadata(body),
    })
    return redirectWithFlash(c, `/workflows/${workflow.id}`, { kind: 'success', message: 'Workflow updated.' })
  })

  wf.post('/:id/delete', (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    if (!workflow) return c.text('Not found', 404)
    deleteWorkflow(db, workflow.id)
    return redirectWithFlash(c, '/workflows', { kind: 'success', message: 'Workflow deleted.' })
  })

  wf.get('/:id/checks/new', (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    if (!workflow) return c.text('Not found', 404)
    const requested = c.req.query('type')
    const checkType: CheckType = (CHECK_TYPES as string[]).includes(requested ?? '')
      ? (requested as CheckType)
      : 'heartbeat'
    const content = `<div class="page-head">
        <h1>New check</h1>
        <a class="btn" href="/workflows/${workflow.id}">Back</a>
      </div>
      <div class="card">
        <h2 class="muted small" style="text-transform:uppercase;letter-spacing:.04em">Check type</h2>
        ${checkTypePicker(workflow.id, checkType)}
        <form method="post" action="/workflows/${workflow.id}/checks">${checkFormFields(checkType)}
          <div class="actions">
            <button class="btn primary" type="submit">Create check</button>
            <a class="btn" href="/workflows/${workflow.id}">Cancel</a>
          </div>
        </form>
      </div>`
    return c.html(pageShell({ title: 'New check', active: 'workflows', content }))
  })

  wf.post('/:id/checks', async (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    if (!workflow) return c.text('Not found', 404)
    const body = await formBody(c)
    const name = body.name?.trim()
    const checkType = body.check_type as CheckType
    if (!name || !(CHECK_TYPES as string[]).includes(checkType)) {
      return redirectWithFlash(c, `/workflows/${workflow.id}/checks/new`, { kind: 'error', message: 'Name and a valid check type are required.' })
    }
    createCheck(db, {
      workflow_id: workflow.id,
      check_type: checkType,
      name,
      config: parseConfig(checkType, body),
      severity: isValidSeverity(body.severity) ? body.severity : 'warning',
      is_enabled: body.is_enabled === 'on',
    })
    return redirectWithFlash(c, `/workflows/${workflow.id}`, { kind: 'success', message: 'Check created.' })
  })

  wf.get('/:id/checks/:checkId/edit', (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    const check = getCheck(db, c.req.param('checkId'))
    if (!workflow || !check || check.workflow_id !== workflow.id) return c.text('Not found', 404)
    const content = `<div class="page-head">
        <h1>Edit check</h1>
        <a class="btn" href="/workflows/${workflow.id}">Back</a>
      </div>
      <div class="card">
        <form method="post" action="/workflows/${workflow.id}/checks/${check.id}">${checkFormFields(check.check_type, check)}
          <div class="actions">
            <button class="btn primary" type="submit">Save changes</button>
            <a class="btn" href="/workflows/${workflow.id}">Cancel</a>
          </div>
        </form>
      </div>`
    return c.html(pageShell({ title: `Edit ${check.name}`, active: 'workflows', content }))
  })

  wf.post('/:id/checks/:checkId', async (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    const check = getCheck(db, c.req.param('checkId'))
    if (!workflow || !check || check.workflow_id !== workflow.id) return c.text('Not found', 404)
    const body = await formBody(c)
    const name = body.name?.trim()
    if (!name) {
      return redirectWithFlash(c, `/workflows/${workflow.id}/checks/${check.id}/edit`, { kind: 'error', message: 'Name is required.' })
    }
    updateCheck(db, check.id, {
      name,
      config: parseConfig(check.check_type, body),
      severity: isValidSeverity(body.severity) ? body.severity : 'warning',
      is_enabled: body.is_enabled === 'on',
    })
    return redirectWithFlash(c, `/workflows/${workflow.id}`, { kind: 'success', message: 'Check updated.' })
  })

  wf.post('/:id/checks/:checkId/delete', (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    const check = getCheck(db, c.req.param('checkId'))
    if (!workflow || !check || check.workflow_id !== workflow.id) return c.text('Not found', 404)
    deleteCheck(db, check.id)
    return redirectWithFlash(c, `/workflows/${workflow.id}`, { kind: 'success', message: 'Check deleted.' })
  })

  app.route('/workflows', wf)
}
