/**
 * Incidents list and incident detail, including manual state transitions.
 * Incidents are archived by status/retention, never deleted from the UI.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import type { IncidentStatus, Severity } from '@yieldcue/contracts'
import { isValidTransition } from '@yieldcue/contracts'
import {
  appendIncidentEvent,
  getIncident,
  listIncidentEvents,
  listIncidents,
  updateIncident,
} from '../db/incidents.ts'
import { getWorkflow, listWorkflows } from '../db/workflows.ts'
import { getCheck } from '../db/checks.ts'
import { parseJson } from '../db/types.ts'
import { chip, escapeHtml, fmtDateTime, pageShell } from './layout.ts'
import { formBody, readFlash, redirectWithFlash } from './helpers.ts'

const KIND_LABELS: Record<string, string> = {
  opened: 'Opened',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  ignored: 'Ignored',
  reopened: 'Reopened',
  assigned: 'Assigned',
  escalated: 'Escalated',
  updated: 'Updated',
  auto_resolved: 'Auto-resolved',
}

function statusOptions(selected: string): string {
  const options = [
    ['', 'All'],
    ['active', 'Active (open + acknowledged)'],
    ['open', 'Open'],
    ['acknowledged', 'Acknowledged'],
    ['resolved', 'Resolved'],
    ['ignored', 'Ignored'],
  ] as const
  return options
    .map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`)
    .join('')
}

function severityOptions(selected: string): string {
  const options = [['', 'All'], ['critical', 'Critical'], ['warning', 'Warning'], ['info', 'Info']] as const
  return options
    .map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`)
    .join('')
}

function renderIncidentList(
  db: DatabaseSync,
  filter: { status?: string; severity?: string; workflow?: string }
): string {
  const status = filter.status || undefined
  const severity = filter.severity || undefined
  const workflowId = filter.workflow || undefined
  const incidents = listIncidents(db, {
    status: (status as IncidentStatus | 'active') || undefined,
    severity: (severity as Severity) || undefined,
    workflow_id: workflowId,
  })

  const workflowSelect = listWorkflows(db)
    .map((w) => `<option value="${w.id}"${workflowId === w.id ? ' selected' : ''}>${escapeHtml(w.name)}</option>`)
    .join('')

  const filterBar = `<form class="card" method="get" action="/incidents">
      <div class="form-row">
        <div class="field"><label for="status">Status</label><select id="status" name="status">${statusOptions(status ?? '')}</select></div>
        <div class="field"><label for="severity">Severity</label><select id="severity" name="severity">${severityOptions(severity ?? '')}</select></div>
        <div class="field"><label for="workflow">Workflow</label><select id="workflow" name="workflow"><option value="">All</option>${workflowSelect}</select></div>
        <div class="field" style="align-self:flex-end"><button class="btn" type="submit">Filter</button></div>
      </div>
    </form>`

  const table = incidents.length
    ? `<table>
        <thead><tr><th>Incident</th><th>Workflow</th><th>Severity</th><th>Status</th><th>Opened</th></tr></thead>
        <tbody>${incidents
          .map((i) => {
            const workflow = getWorkflow(db, i.workflow_id)
            return `<tr>
              <td><a href="/incidents/${i.id}">${escapeHtml(i.title)}</a></td>
              <td>${workflow ? `<a href="/workflows/${workflow.id}">${escapeHtml(workflow.name)}</a>` : '—'}</td>
              <td>${chip(i.severity, i.severity)}</td>
              <td>${chip(i.status, i.status)}</td>
              <td>${fmtDateTime(i.opened_at)}</td>
            </tr>`
          })
          .join('')}
        </tbody>
      </table>`
    : `<div class="empty">No incidents match the current filters.</div>`

  return `<div class="page-head"><h1>Incidents</h1></div>${filterBar}
    <div class="card">${table}</div>`
}

function transitionForm(
  incidentId: string,
  action: string,
  label: string,
  noteField: boolean,
  danger = false
): string {
  return `<form method="post" action="/incidents/${incidentId}/${action}" style="margin-bottom:0.5rem">
    ${noteField ? `<div class="field"><input type="text" name="note" placeholder="Optional note"></div>` : ''}
    <button class="btn ${danger ? 'danger' : 'primary'} small" type="submit">${label}</button>
  </form>`
}

function renderIncidentDetail(
  db: DatabaseSync,
  incidentId: string
): string {
  const incident = getIncident(db, incidentId)
  if (!incident) return ''
  const workflow = getWorkflow(db, incident.workflow_id)
  const check = incident.check_id ? getCheck(db, incident.check_id) : null
  const events = listIncidentEvents(db, incident.id)

  const actions: string[] = []
  if (isValidTransition(incident.status, 'acknowledged')) {
    actions.push(transitionForm(incident.id, 'acknowledge', 'Acknowledge', true))
  }
  if (isValidTransition(incident.status, 'resolved')) {
    actions.push(transitionForm(incident.id, 'resolve', 'Resolve', true))
  }
  if (isValidTransition(incident.status, 'ignored')) {
    actions.push(transitionForm(incident.id, 'ignore', 'Ignore', true, true))
  }
  if (isValidTransition(incident.status, 'open')) {
    actions.push(transitionForm(incident.id, 'reopen', 'Reopen', false))
  }

  const timeline = events.length
    ? `<ul class="timeline">${events
        .map((e) => {
          const payload = parseJson<Record<string, unknown>>(e.payload)
          const note = payload.reason ?? payload.message
          return `<li>
            <span class="t-kind">${escapeHtml(KIND_LABELS[e.kind] ?? e.kind)}</span>
            <span>${note ? escapeHtml(String(note)) : ''}</span>
            <span class="t-time">${fmtDateTime(e.created_at)}</span>
          </li>`
        })
        .join('')}
      </ul>`
    : `<div class="empty">No history.</div>`

  return `<div class="page-head">
      <div>
        <h1>${escapeHtml(incident.title)} ${chip(incident.status, incident.status)} ${chip(incident.severity, incident.severity)}</h1>
        <div class="muted">${escapeHtml(incident.description || 'No description')}</div>
      </div>
      <a class="btn" href="/incidents">Back</a>
    </div>

    <div class="card">
      <div class="card-head"><h2>Actions</h2></div>
      ${actions.length ? `<div class="actions" style="align-items:flex-start">${actions.join('')}</div>` : `<div class="empty">No transitions available for this status.</div>`}
    </div>

    <div class="card">
      <h2>Details</h2>
      <dl class="meta">
        <dt>Workflow</dt><dd>${workflow ? `<a href="/workflows/${workflow.id}">${escapeHtml(workflow.name)}</a>` : '—'}</dd>
        <dt>Check</dt><dd>${check ? escapeHtml(check.name) : '—'}</dd>
        <dt>Opened</dt><dd>${fmtDateTime(incident.opened_at)}</dd>
        <dt>Acknowledged</dt><dd>${fmtDateTime(incident.acknowledged_at)}</dd>
        <dt>Resolved</dt><dd>${fmtDateTime(incident.resolved_at)}</dd>
        <dt>Updated</dt><dd>${fmtDateTime(incident.updated_at)}</dd>
        <dt>Fingerprint</dt><dd><code class="small">${escapeHtml(incident.fingerprint)}</code></dd>
      </dl>
    </div>

    <div class="card">
      <h2>Timeline</h2>
      ${timeline}
    </div>`
}

export function mountIncidents(app: Hono, db: DatabaseSync): void {
  const inc = new Hono()

  inc.get('/', (c) => {
    const filter = {
      status: c.req.query('status') ?? '',
      severity: c.req.query('severity') ?? '',
      workflow: c.req.query('workflow') ?? '',
    }
    const content = renderIncidentList(db, filter)
    return c.html(pageShell({ title: 'Incidents', active: 'incidents', content, flash: readFlash(c) }))
  })

  inc.get('/:id', (c) => {
    const id = c.req.param('id')
    if (!getIncident(db, id)) return c.text('Not found', 404)
    const content = renderIncidentDetail(db, id)
    return c.html(pageShell({ title: 'Incident', active: 'incidents', content, flash: readFlash(c) }))
  })

  async function transition(
    c: Context,
    target: IncidentStatus,
    fields: { acknowledged_at?: string | null; resolved_at?: string | null; last_resolved_at?: string | null; opened_at?: string },
    eventKind: Parameters<typeof appendIncidentEvent>[2]
  ): Promise<Response> {
    const id = c.req.param('id')!
    const incident = getIncident(db, id)
    if (!incident) return c.text('Not found', 404)
    if (!isValidTransition(incident.status, target)) {
      return redirectWithFlash(c, `/incidents/${id}`, { kind: 'error', message: 'That transition is not allowed from the current status.' })
    }
    const body = await formBody(c)
    const note = body.note?.trim()
    updateIncident(db, id, { status: target, ...fields })
    appendIncidentEvent(db, id, eventKind, note ? { reason: note } : {})
    return redirectWithFlash(c, `/incidents/${id}`, { kind: 'success', message: 'Incident updated.' })
  }

  inc.post('/:id/acknowledge', (c) =>
    transition(c, 'acknowledged', { acknowledged_at: new Date().toISOString() }, 'acknowledged')
  )
  inc.post('/:id/resolve', (c) =>
    transition(c, 'resolved', {
      resolved_at: new Date().toISOString(),
      last_resolved_at: new Date().toISOString(),
    }, 'resolved')
  )
  inc.post('/:id/ignore', (c) => transition(c, 'ignored', {}, 'ignored'))
  inc.post('/:id/reopen', (c) =>
    transition(c, 'open', {
      acknowledged_at: null,
      resolved_at: null,
      opened_at: new Date().toISOString(),
    }, 'reopened')
  )

  app.route('/incidents', inc)
}
