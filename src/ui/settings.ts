/**
 * Settings screen: alert destinations, data export, Prepare for Cloud, and
 * retention/ingest reference. Secret values (webhook URLs, API keys) are
 * never rendered in list views.
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
import { countEvents } from '../db/events.ts'
import { countIncidents } from '../db/incidents.ts'
import { parseJson, toBool, type AlertRouteRow } from '../db/types.ts'
import { handlePrepareForCloud } from '../export.ts'
import { chip, escapeHtml, pageShell } from './layout.ts'
import { formBody, readFlash, redirectWithFlash } from './helpers.ts'

const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

function maskDestination(route: AlertRouteRow): string {
  if (route.integration_kind === 'slack_webhook') return 'Slack webhook'
  const dest = parseJson<{ to?: string }>(route.destination)
  return dest.to ? `Email → ${escapeHtml(dest.to)}` : 'Email'
}

function routeFiltersHtml(route: AlertRouteRow, db: DatabaseSync): string {
  const workflow = route.filter_workflow_id ? getWorkflow(db, route.filter_workflow_id) : null
  const workflowLabel = workflow ? escapeHtml(workflow.name) : 'All workflows'
  const severities = parseJson<Severity[]>(route.filter_severity)
  const severityLabel = severities.length ? severities.join(', ') : 'All severities'
  return `<span class="muted small">${workflowLabel} · ${escapeHtml(severityLabel)} · ${route.cooldown_minutes}m cooldown</span>`
}

function renderAlertRoutes(db: DatabaseSync): string {
  const routes = listAlertRoutes(db)
  const rows = routes.length
    ? `<table>
        <thead><tr><th>Kind</th><th>Destination</th><th>Filters</th><th>Status</th><th></th></tr></thead>
        <tbody>${routes
          .map((route) => {
            return `<tr>
              <td>${escapeHtml(route.integration_kind === 'slack_webhook' ? 'Slack' : 'Email')}</td>
              <td>${maskDestination(route)}</td>
              <td>${routeFiltersHtml(route, db)}</td>
              <td>${chip(toBool(route.is_enabled) ? 'enabled' : 'disabled', toBool(route.is_enabled) ? 'active' : 'disabled')}</td>
              <td class="actions">
                <form class="inline-form" method="post" action="/settings/alert-routes/${route.id}/toggle">
                  <button class="btn small" type="submit">${toBool(route.is_enabled) ? 'Disable' : 'Enable'}</button>
                </form>
                <form class="inline-form" method="post" action="/settings/alert-routes/${route.id}/delete" hx-post="/settings/alert-routes/${route.id}/delete" hx-confirm="Delete this alert destination?">
                  <button class="btn small danger" type="submit">Delete</button>
                </form>
              </td>
            </tr>`
          })
          .join('')}
        </tbody>
      </table>`
    : `<div class="empty">No alert destinations configured.</div>`

  return `<div class="card-head"><h2>Alert destinations</h2><a class="btn primary small" href="/settings/alert-routes/new?kind=slack_webhook">Add destination</a></div>${rows}`
}

function destinationFields(kind: string): string {
  if (kind === 'email') {
    return `
      <input type="hidden" name="integration_kind" value="email">
      <div class="field"><label for="from_address">From address</label><input id="from_address" type="text" name="from_address" required></div>
      <div class="field"><label for="from_name">From name (optional)</label><input id="from_name" type="text" name="from_name"></div>
      <div class="field"><label for="to">To address</label><input id="to" type="text" name="to" required></div>
      <div class="field"><label for="api_key">Resend API key</label><input id="api_key" type="password" name="api_key" required></div>`
  }
  return `
    <input type="hidden" name="integration_kind" value="slack_webhook">
    <div class="field"><label for="webhook_url">Slack webhook URL</label><input id="webhook_url" type="text" name="webhook_url" required></div>`
}

function alertRouteForm(db: DatabaseSync, kind: string): string {
  const workflowOptions = listWorkflows(db)
    .map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`)
    .join('')

  return `<div class="page-head"><h1>New alert destination</h1><a class="btn" href="/settings">Back</a></div>
    <div class="card">
      <div class="actions" style="margin-bottom:1rem">
        <a class="btn small${kind !== 'email' ? ' primary' : ''}" href="/settings/alert-routes/new?kind=slack_webhook">Slack webhook</a>
        <a class="btn small${kind === 'email' ? ' primary' : ''}" href="/settings/alert-routes/new?kind=email">Email</a>
      </div>
      <form method="post" action="/settings/alert-routes">
        ${destinationFields(kind)}
        <div class="field">
          <label for="filter_workflow_id">Restrict to workflow</label>
          <select id="filter_workflow_id" name="filter_workflow_id"><option value="">All workflows</option>${workflowOptions}</select>
        </div>
        <div class="field">
          <label>Trigger on severities (none = all)</label>
          <div class="form-row">
            ${SEVERITIES.map(
              (s) => `<label class="checkbox-row"><input type="checkbox" name="severity_${s}" checked> ${s}</label>`
            ).join('')}
          </div>
        </div>
        <div class="field">
          <label for="cooldown_minutes">Cooldown (minutes)</label>
          <input id="cooldown_minutes" type="number" name="cooldown_minutes" value="0" min="0">
        </div>
        <div class="field checkbox-row">
          <input type="checkbox" id="is_enabled" name="is_enabled" checked>
          <label for="is_enabled">Enabled</label>
        </div>
        <div class="actions">
          <button class="btn primary" type="submit">Add destination</button>
          <a class="btn" href="/settings">Cancel</a>
        </div>
      </form>
    </div>`
}

function renderSettings(db: DatabaseSync): string {
  return `<div class="page-head"><h1>Settings</h1></div>

    <div class="card">${renderAlertRoutes(db)}</div>

    <div class="card">
      <div class="card-head"><h2>Data export</h2></div>
      <p class="muted">Download a JSON snapshot of your workflows, checks, events, and incidents. Notification credentials and secret values are excluded.</p>
      <a class="btn" href="/export">Download data export</a>
    </div>

    <div class="card">
      <div class="card-head"><h2>Prepare for Cloud</h2></div>
      <p class="muted">Create a setup bundle for import into YieldCue Cloud. It contains workflows and checks only; event history, incidents, and alert destinations are omitted. Review the bundle before uploading — the format does not detect secret-like values pasted into descriptions or metadata.</p>
      <a class="btn" href="/settings/prepare-for-cloud">Download setup bundle</a>
    </div>

    <div class="card">
      <div class="card-head"><h2>Retention</h2></div>
      <dl class="meta">
        <dt>Events</dt><dd>90 days</dd>
        <dt>Incidents</dt><dd>1 year</dd>
        <dt>Terminal deliveries</dt><dd>180 days</dd>
      </dl>
    </div>

    <div class="card">
      <div class="card-head"><h2>Ingest</h2></div>
      <p class="muted">Send workflow outcome signals to this endpoint with the ingest bearer token.</p>
      <dl class="meta">
        <dt>Endpoint</dt><dd><code>POST /v1/ingest/events</code></dd>
        <dt>Auth</dt><dd><code>Authorization: Bearer $YIELDCUE_INGEST_TOKEN</code></dd>
        <dt>Events stored</dt><dd>${countEvents(db)}</dd>
        <dt>Incidents stored</dt><dd>${countIncidents(db)}</dd>
      </dl>
    </div>`
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
      if (!body.to || !body.from_address || !body.api_key) {
        return redirectWithFlash(c, '/settings/alert-routes/new?kind=email', { kind: 'error', message: 'To address, from address, and API key are required.' })
      }
      destination = {
        api_key: body.api_key,
        from_address: body.from_address,
        ...(body.from_name ? { from_name: body.from_name } : {}),
        to: body.to,
      }
    } else {
      if (!body.webhook_url) {
        return redirectWithFlash(c, '/settings/alert-routes/new?kind=slack_webhook', { kind: 'error', message: 'Webhook URL is required.' })
      }
      destination = { webhook_url: body.webhook_url }
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
