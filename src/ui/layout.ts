/**
 * Escaping, chips, dates, and the page shell. Markup lives in src/ui/html.
 */

import { renderHtml } from './templates.ts'

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return escapeHtml(iso)
  const day = d.getUTCDate()
  const month = MONTHS[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${month} ${year}, ${hh}:${mm} UTC`
}

export function chip(text: string, kind: string): string {
  return renderHtml('chip.html', { kind: escapeHtml(kind), text: escapeHtml(text) })
}

export type Flash = { kind: 'success' | 'error'; message: string }

export function flashHtml(flash: Flash | null): string {
  if (!flash) return ''
  return renderHtml('flash.html', { kind: escapeHtml(flash.kind), message: escapeHtml(flash.message) })
}

export interface PageOptions {
  title: string
  active: 'workflows' | 'incidents' | 'settings'
  content: string
  flash?: Flash | null
}

export function pageShell(opts: PageOptions): string {
  return renderHtml('layout.html', {
    title: escapeHtml(opts.title),
    nav_workflows: opts.active === 'workflows' ? 'active' : '',
    nav_incidents: opts.active === 'incidents' ? 'active' : '',
    nav_settings: opts.active === 'settings' ? 'active' : '',
    flash: flashHtml(opts.flash ?? null),
    content: opts.content,
  })
}

export function emptyState(message: string): string {
  return renderHtml('empty-state.html', { message: escapeHtml(message) })
}

export function dataTable(headers: string[], body: string): string {
  return renderHtml('data-table.html', {
    headers: headers.map((header) => renderHtml('table-header.html', { header: escapeHtml(header) })).join(''),
    body,
  })
}
