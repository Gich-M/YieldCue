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
import { chip, dataTable, emptyState, escapeHtml, fmtDateTime, pageShell } from './layout.ts'
import {
  CHECK_TYPES,
  CHECK_TYPE_LABELS,
  parseConfig,
  renderConfigFields,
  summarizeConfig,
} from './check-config.ts'
import { htmlTemplate, renderHtml } from './templates.ts'
import { formBody, readFlash, redirectWithFlash } from './helpers.ts'

const STATUSES = ['active', 'paused', 'disabled'] as const
const SEVERITIES: Severity[] = ['critical', 'warning', 'info']
const PROVIDERS = [
  ['zapier', 'Zapier - Webhook by Zap'],
  ['make', 'Make - HTTP module'],
  ['n8n', 'n8n - HTTP Request node'],
  ['airtable', 'Airtable - Automation script'],
  ['hubspot', 'HubSpot - Workflow action'],
] as const
const ENVIRONMENTS = [
  ['', 'None'],
  ['production', 'Production'],
  ['staging', 'Staging'],
  ['development', 'Development'],
] as const

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
  const selectedProvider = value('provider') || 'n8n'
  const selectedEnvironment = value('environment')
  const providerChoices: ReadonlyArray<readonly [string, string]> =
    selectedProvider && !PROVIDERS.some(([provider]) => provider === selectedProvider)
      ? [[selectedProvider, selectedProvider], ...PROVIDERS]
      : PROVIDERS
  const environmentChoices: ReadonlyArray<readonly [string, string]> =
    selectedEnvironment && !ENVIRONMENTS.some(([environment]) => environment === selectedEnvironment)
      ? [...ENVIRONMENTS, [selectedEnvironment, selectedEnvironment]]
      : ENVIRONMENTS

  return renderHtml('workflow-fields.html', {
    name: workflow ? escapeHtml(workflow.name) : '',
    status_options: STATUSES.map((status) =>
      renderHtml('option.html', {
        value: status,
        selected: workflow?.status === status ? ' selected' : '',
        label: status,
      })
    ).join(''),
    workflow_key_field: workflow ? '' : htmlTemplate('workflow-key-field.html'),
    description: workflow ? escapeHtml(workflow.description) : '',
    provider_options: providerChoices.map(([provider, label]) =>
      renderHtml('option.html', {
        value: escapeHtml(provider),
        selected: selectedProvider === provider ? ' selected' : '',
        label: escapeHtml(label),
      })
    ).join(''),
    environment_options: environmentChoices.map(([environment, label]) =>
      renderHtml('option.html', {
        value: escapeHtml(environment),
        selected: selectedEnvironment === environment ? ' selected' : '',
        label: escapeHtml(label),
      })
    ).join(''),
  })
}

// --- Workflows list ---

function renderWorkflowList(rows: ReturnType<typeof listWorkflows>): string {
  const table =
    rows.length === 0
      ? emptyState('No workflows yet. Create one, then send events to its workflow key.')
      : dataTable(
          ['Name', 'Key', 'Status', 'Checks', 'Open', 'Updated'],
          rows
            .map(
              (w) =>
                renderHtml('workflow-row.html', {
                  id: escapeHtml(w.id),
                  name: escapeHtml(w.name),
                  workflow_key: escapeHtml(w.workflow_key),
                  status: chip(w.status, w.status),
                  check_count: String(w.check_count),
                  open_incident_count: String(w.open_incident_count),
                  updated_at: fmtDateTime(w.updated_at),
                })
            )
            .join('')
        )

  return renderHtml('workflows-list.html', { table })
}

// --- Workflow detail ---

function checkRowsHtml(workflowId: string, checks: CheckRow[]): string {
  if (checks.length === 0) {
    return emptyState('No checks yet. Add one to start raising incidents.')
  }
  return dataTable(
    ['Name', 'Type', 'Severity', 'Config', ''],
    checks
      .map((check) => {
        const config = parseJson<Record<string, unknown>>(check.config)
        return renderHtml('check-row.html', {
          workflow_id: escapeHtml(workflowId),
          id: escapeHtml(check.id),
          name: escapeHtml(check.name),
          disabled_chip: toBool(check.is_enabled) ? '' : ` ${chip('disabled', 'disabled')}`,
          type: escapeHtml(CHECK_TYPE_LABELS[check.check_type]),
          severity: chip(check.severity, check.severity),
          config: escapeHtml(summarizeConfig(check.check_type, config)),
        })
      })
      .join('')
  )
}

function renderWorkflowDetail(
  workflow: WorkflowRow,
  checks: CheckRow[],
  recentIncidents: ReturnType<typeof listIncidents>,
  recentEvents: ReturnType<typeof listWorkflowEvents>
): string {
  const metadata = parseJson<Record<string, unknown>>(workflow.metadata)
  const incidentsHtml = recentIncidents.length
    ? dataTable(
        ['Incident', 'Status', 'Severity', 'Opened'],
        recentIncidents
          .map(
            (i) =>
              renderHtml('workflow-incident-row.html', {
                id: escapeHtml(i.id),
                title: escapeHtml(i.title),
                status: chip(i.status, i.status),
                severity: chip(i.severity, i.severity),
                opened_at: fmtDateTime(i.opened_at),
              })
          )
          .join('')
      )
    : emptyState('No incidents for this workflow.')

  const eventsHtml = recentEvents.length
    ? dataTable(
        ['Type', 'Status', 'Received', ''],
        recentEvents
          .map((row) => {
            const e = eventRowToDomain(row)
            const status = (e.payload as { status?: string }).status
            return renderHtml('workflow-event-row.html', {
              event_type: escapeHtml(e.event_type),
              status: status ? chip(status, status === 'ok' ? 'resolved' : status === 'warn' ? 'warning' : 'critical') : '—',
              received_at: fmtDateTime(e.received_at),
              test_chip: e.is_test ? chip('test', 'ignored') : '',
            })
          })
          .join('')
      )
    : emptyState('No events received yet.')

  return renderHtml('workflow-detail.html', {
    id: escapeHtml(workflow.id),
    name: escapeHtml(workflow.name),
    status_chip: chip(workflow.status, workflow.status),
    description: escapeHtml(workflow.description || 'No description'),
    workflow_key: escapeHtml(workflow.workflow_key),
    provider: escapeHtml(String(metadata.provider ?? '—')),
    environment: escapeHtml(String(metadata.environment ?? '—')),
    checks: checkRowsHtml(workflow.id, checks),
    incidents: incidentsHtml,
    events: eventsHtml,
  })
}

// --- Check form ---

function checkTypePicker(workflowId: string, selected: CheckType): string {
  const options = CHECK_TYPES.map((type) =>
    renderHtml('option.html', {
      value: type,
      selected: type === selected ? ' selected' : '',
      label: escapeHtml(CHECK_TYPE_LABELS[type]),
    })
  ).join('')
  return renderHtml('check-type-picker.html', { workflow_id: escapeHtml(workflowId), options })
}

function checkFormFields(checkType: CheckType, check?: CheckRow): string {
  const config = check ? parseJson<Record<string, unknown>>(check.config) : {}
  const typeField = check
    ? renderHtml('check-type-display.html', { type: escapeHtml(CHECK_TYPE_LABELS[check.check_type]) })
    : renderHtml('check-type-hidden.html', { type: escapeHtml(checkType) })
  const severity = check?.severity ?? 'warning'
  const name = check?.name ?? ''

  return renderHtml('check-fields.html', {
    type_field: typeField,
    name: escapeHtml(name),
    severity_options: SEVERITIES.map((item) =>
      renderHtml('option.html', {
        value: item,
        selected: severity === item ? ' selected' : '',
        label: item,
      })
    ).join(''),
    enabled: check ? (toBool(check.is_enabled) ? ' checked' : '') : ' checked',
    config_fields: renderConfigFields(checkType, config),
  })
}

// --- Handlers ---

export function mountWorkflows(app: Hono, db: DatabaseSync): void {
  const wf = new Hono()

  wf.get('/', (c) => {
    const content = renderWorkflowList(listWorkflows(db))
    return c.html(pageShell({ title: 'Workflows', active: 'workflows', content, flash: readFlash(c) }))
  })

  wf.get('/new', (c) => {
    const content = renderHtml('form-page.html', {
      heading: 'New workflow',
      lede: 'The workflow key is what senders put in each event.',
      back_href: '/workflows',
      back_label: 'Back',
      preamble: '',
      action: '/workflows',
      fields: workflowFields(),
      submit_label: 'Create workflow',
      cancel_href: '/workflows',
    })
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
      listWorkflowEvents(db, workflow.id, { limit: 20 })
    )
    return c.html(pageShell({ title: workflow.name, active: 'workflows', content, flash: readFlash(c) }))
  })

  wf.get('/:id/edit', (c) => {
    const workflow = getWorkflow(db, c.req.param('id'))
    if (!workflow) return c.text('Not found', 404)
    const content = renderHtml('form-page.html', {
      heading: 'Edit workflow',
      lede: 'The workflow key cannot be changed after creation.',
      back_href: `/workflows/${workflow.id}`,
      back_label: 'Back',
      preamble: '',
      action: `/workflows/${workflow.id}`,
      fields: workflowFields(workflow),
      submit_label: 'Save changes',
      cancel_href: `/workflows/${workflow.id}`,
    })
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
    const content = renderHtml('check-form.html', {
      heading: 'New check',
      lede: 'Pick a type, then set the threshold that should open an incident.',
      workflow_id: workflow.id,
      type_picker: checkTypePicker(workflow.id, checkType),
      action: `/workflows/${workflow.id}/checks`,
      fields: checkFormFields(checkType),
      submit_label: 'Create check',
    })
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
    const content = renderHtml('check-form.html', {
      heading: 'Edit check',
      lede: escapeHtml(CHECK_TYPE_LABELS[check.check_type]),
      workflow_id: workflow.id,
      type_picker: '',
      action: `/workflows/${workflow.id}/checks/${check.id}`,
      fields: checkFormFields(check.check_type, check),
      submit_label: 'Save changes',
    })
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
