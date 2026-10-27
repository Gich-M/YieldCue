/**
 * Settings: alert destinations, ingest reference, retention, and exports.
 * Destination secrets are never rendered in list views.
 */

import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import type { Severity } from '@yieldcue/contracts'
import {
  createAlertRoute,
  deleteAlertRoute,
  getAlertRoute,
  listAlertRoutes,
  updateAlertRoute,
} from '../db/alert-routes.ts'
import { getWorkflow, listWorkflows } from '../db/workflows.ts'
import { parseJson, toBool, type AlertRouteRow } from '../db/types.ts'
import { parseSmtpDestination } from '../engine/smtp.ts'
import { handlePrepareForCloud } from '../export.ts'
import { chip, dataTable, emptyState, escapeHtml, pageShell } from './layout.ts'
import { htmlTemplate, renderHtml } from './templates.ts'
import { formBody, readFlash, redirectWithFlash } from './helpers.ts'

const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

function maskDestination(route: AlertRouteRow): string {
  if (route.integration_kind === 'slack_webhook') return 'Slack webhook'
  const dest = parseJson<{ to?: string; host?: string }>(route.destination)
  if (dest.to && dest.host) return `${escapeHtml(dest.to)} via ${escapeHtml(dest.host)}`
  if (dest.to) return escapeHtml(dest.to)
  return 'Email'
}

function routeFiltersHtml(route: AlertRouteRow, db: DatabaseSync): string {
  const workflow = route.filter_workflow_id ? getWorkflow(db, route.filter_workflow_id) : null
  const workflowLabel = workflow ? escapeHtml(workflow.name) : 'All workflows'
  const severities = parseJson<Severity[]>(route.filter_severity)
  const severityLabel = severities.length ? severities.join(', ') : 'All severities'
  const cooldown = route.cooldown_minutes > 0 ? `${route.cooldown_minutes}m cooldown` : 'No cooldown'
  return renderHtml('route-filters.html', {
    workflow: workflowLabel,
    severities: escapeHtml(severityLabel),
    cooldown,
  })
}

function renderAlertRoutes(db: DatabaseSync): string {
  const routes = listAlertRoutes(db)
  if (routes.length === 0) {
    return emptyState('No alert destinations yet. Add Slack or SMTP email to be notified when an incident opens.')
  }

  const body = routes
    .map((route) => {
      const enabled = toBool(route.is_enabled)
      return renderHtml('alert-route-row.html', {
        id: escapeHtml(route.id),
        kind: escapeHtml(route.integration_kind === 'slack_webhook' ? 'Slack' : 'Email'),
        destination: maskDestination(route),
        filters: routeFiltersHtml(route, db),
        status: chip(enabled ? 'enabled' : 'disabled', enabled ? 'active' : 'disabled'),
        toggle_label: enabled ? 'Disable' : 'Enable',
      })
    })
    .join('')

  return dataTable(['Kind', 'Destination', 'Filters', 'Status', ''], body)
}

function alertRouteForm(db: DatabaseSync, kind: string): string {
  const workflowOptions = listWorkflows(db)
    .map((workflow) =>
      renderHtml('option.html', { value: escapeHtml(workflow.id), selected: '', label: escapeHtml(workflow.name) })
    )
    .join('')
  const severityChecks = SEVERITIES.map(
    (severity) => renderHtml('severity-checkbox.html', { severity, label: escapeHtml(severity) })
  ).join('')

  return renderHtml('alert-route-form.html', {
    lede:
      kind === 'email'
        ? 'Send mail through any SMTP server you control — Google Workspace, Amazon SES, Postfix, Mailgun, and similar.'
        : 'Post incident alerts to a Slack incoming webhook.',
    slack_class: kind !== 'email' ? ' primary' : '',
    email_class: kind === 'email' ? ' primary' : '',
    destination_fields: htmlTemplate(kind === 'email' ? 'email-fields.html' : 'slack-fields.html'),
    workflow_options: workflowOptions,
    severity_checks: severityChecks,
  })
}

function renderSettings(db: DatabaseSync): string {
  return renderHtml('settings.html', { alert_routes: renderAlertRoutes(db) })
}

export function mountSettings(app: Hono, db: DatabaseSync): void {
  const settings = new Hono()

  settings.get('/', (c) => {
    const content = renderSettings(db)
    return c.html(pageShell({ title: 'Settings', active: 'settings', content, flash: readFlash(c) }))
  })

  settings.get('/prepare-for-cloud', (c) => handlePrepareForCloud(c, db))

  settings.get('/alert-routes/new', (c) => {
    const kind = c.req.query('kind') === 'email' ? 'email' : 'slack_webhook'
    const content = alertRouteForm(db, kind)
    return c.html(pageShell({ title: 'New alert destination', active: 'settings', content }))
  })

  settings.post('/alert-routes', async (c) => {
    const body = await formBody(c)
    const kind = body.integration_kind === 'email' ? 'email' : 'slack_webhook'
    const severities = SEVERITIES.filter((s) => body[`severity_${s}`] === 'on')

    let destination: Record<string, unknown>
    if (kind === 'email') {
      const parsed = parseSmtpDestination(body)
      if (!parsed) {
        return redirectWithFlash(c, '/settings/alert-routes/new?kind=email', {
          kind: 'error',
          message: 'A valid to address, from address, SMTP host, and port are required.',
        })
      }
      destination = { ...parsed }
    } else {
      const webhookUrl = body.webhook_url?.trim()
      if (!webhookUrl) {
        return redirectWithFlash(c, '/settings/alert-routes/new?kind=slack_webhook', {
          kind: 'error',
          message: 'Webhook URL is required.',
        })
      }
      destination = { webhook_url: webhookUrl }
    }

    createAlertRoute(db, {
      integration_kind: kind,
      destination,
      filter_workflow_id: body.filter_workflow_id || null,
      filter_severity: severities,
      cooldown_minutes: Math.max(0, Number(body.cooldown_minutes) || 0),
      is_enabled: body.is_enabled === 'on',
    })
    return redirectWithFlash(c, '/settings', { kind: 'success', message: 'Alert destination added.' })
  })

  settings.post('/alert-routes/:id/toggle', (c) => {
    const route = getAlertRoute(db, c.req.param('id'))
    if (!route) return c.text('Not found', 404)
    updateAlertRoute(db, route.id, { is_enabled: !toBool(route.is_enabled) })
    return redirectWithFlash(c, '/settings', { kind: 'success', message: 'Alert destination updated.' })
  })

  settings.post('/alert-routes/:id/delete', (c) => {
    const route = getAlertRoute(db, c.req.param('id'))
    if (!route) return c.text('Not found', 404)
    deleteAlertRoute(db, route.id)
    return redirectWithFlash(c, '/settings', { kind: 'success', message: 'Alert destination deleted.' })
  })

  app.route('/settings', settings)
}
