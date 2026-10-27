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
import { chip, dataTable, emptyState, escapeHtml, fmtDateTime, pageShell } from './layout.ts'
import { renderHtml } from './templates.ts'
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
    .map(([value, label]) =>
      renderHtml('option.html', { value, selected: selected === value ? ' selected' : '', label })
    )
    .join('')
}

function severityOptions(selected: string): string {
  const options = [['', 'All'], ['critical', 'Critical'], ['warning', 'Warning'], ['info', 'Info']] as const
  return options
    .map(([value, label]) =>
      renderHtml('option.html', { value, selected: selected === value ? ' selected' : '', label })
    )
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

  const workflows = listWorkflows(db)
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]))

  const workflowSelect = workflows
    .map((workflow) =>
      renderHtml('option.html', {
        value: escapeHtml(workflow.id),
        selected: workflowId === workflow.id ? ' selected' : '',
        label: escapeHtml(workflow.name),
      })
    )
    .join('')

  const table = incidents.length
    ? dataTable(
        ['Incident', 'Workflow', 'Severity', 'Status', 'Opened'],
        incidents
          .map((incident) => {
            const workflow = workflowById.get(incident.workflow_id)
            return renderHtml('incident-list-row.html', {
              id: escapeHtml(incident.id),
              title: escapeHtml(incident.title),
              workflow: workflow
                ? renderHtml('workflow-link.html', { id: escapeHtml(workflow.id), name: escapeHtml(workflow.name) })
                : '—',
              severity: chip(incident.severity, incident.severity),
              status: chip(incident.status, incident.status),
              opened_at: fmtDateTime(incident.opened_at),
            })
          })
          .join('')
      )
    : emptyState('No incidents match the current filters.')

  return renderHtml('incidents-list.html', {
    status_options: statusOptions(status ?? ''),
    severity_options: severityOptions(severity ?? ''),
    workflow_options: workflowSelect,
    table,
  })
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

  const buttons: string[] = []
  if (isValidTransition(incident.status, 'acknowledged')) {
    buttons.push(
      renderHtml('incident-action-button.html', {
        incident_id: escapeHtml(incident.id),
        action: 'acknowledge',
        class_name: ' primary',
        label: 'Acknowledge',
      })
    )
  }
  if (isValidTransition(incident.status, 'resolved')) {
    buttons.push(
      renderHtml('incident-action-button.html', {
        incident_id: escapeHtml(incident.id),
        action: 'resolve',
        class_name: ' primary',
        label: 'Resolve',
      })
    )
  }
  if (isValidTransition(incident.status, 'ignored')) {
    buttons.push(
      renderHtml('incident-action-button.html', {
        incident_id: escapeHtml(incident.id),
        action: 'ignore',
        class_name: ' danger',
        label: 'Ignore',
      })
    )
  }
  if (isValidTransition(incident.status, 'open')) {
    buttons.push(
      renderHtml('incident-action-button.html', {
        incident_id: escapeHtml(incident.id),
        action: 'reopen',
        class_name: '',
        label: 'Reopen',
      })
    )
  }

  const actions = buttons.length
    ? renderHtml('incident-actions.html', { incident_id: escapeHtml(incident.id), buttons: buttons.join('') })
    : emptyState('No further actions for this status.')

  const extraTimes = [
    incident.acknowledged_at
      ? renderHtml('incident-extra-time.html', { label: 'Acknowledged', time: fmtDateTime(incident.acknowledged_at) })
      : '',
    incident.resolved_at
      ? renderHtml('incident-extra-time.html', { label: 'Resolved', time: fmtDateTime(incident.resolved_at) })
      : '',
  ].join('')

  const timelineItems = events
        .map((e) => {
          const payload = parseJson<Record<string, unknown>>(e.payload)
          const note = payload.reason ?? payload.message
          return renderHtml('incident-timeline-item.html', {
            kind: escapeHtml(KIND_LABELS[e.kind] ?? e.kind),
            note: note ? escapeHtml(String(note)) : '',
            created_at: fmtDateTime(e.created_at),
          })
        })
        .join('')
  const timeline = events.length
    ? renderHtml('incident-timeline.html', { items: timelineItems })
    : emptyState('No history yet.')

  return renderHtml('incident-detail.html', {
    title: escapeHtml(incident.title),
    status_chip: chip(incident.status, incident.status),
    severity_chip: chip(incident.severity, incident.severity),
    description: escapeHtml(incident.description || 'No description'),
    actions,
    workflow: workflow
      ? renderHtml('workflow-link.html', { id: escapeHtml(workflow.id), name: escapeHtml(workflow.name) })
      : '—',
    check: check ? escapeHtml(check.name) : '—',
    opened_at: fmtDateTime(incident.opened_at),
    extra_times: extraTimes,
    timeline,
  })
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
