/**
 * Server-side HTML helpers: escaping, page shell, and small formatting.
 * All rendered user data must pass through escapeHtml before interpolation.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return escapeHtml(iso)
  return escapeHtml(d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z'))
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return escapeHtml(iso)
  return escapeHtml(d.toISOString().slice(0, 10))
}

export function chip(text: string, kind: string): string {
  return `<span class="chip ${escapeHtml(kind)}">${escapeHtml(text)}</span>`
}

export type Flash = { kind: 'success' | 'error'; message: string }

export function flashHtml(flash: Flash | null): string {
  if (!flash) return ''
  return `<div class="flash ${flash.kind}">${escapeHtml(flash.message)}</div>`
}

export interface PageOptions {
  title: string
  active: 'workflows' | 'incidents' | 'settings'
  content: string
  flash?: Flash | null
}

const NAV = [
  { href: '/workflows', label: 'Workflows', key: 'workflows' },
  { href: '/incidents', label: 'Incidents', key: 'incidents' },
  { href: '/settings', label: 'Settings', key: 'settings' },
] as const

export function pageShell(opts: PageOptions): string {
  const nav = NAV.map(
    (item) =>
      `<a href="${item.href}"${item.key === opts.active ? ' class="active"' : ''}>${item.label}</a>`
  ).join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} · YieldCue</title>
<link rel="icon" type="image/svg+xml" href="/static/app-icon.svg">
<link rel="stylesheet" href="/static/styles.css">
<script src="/static/htmx.min.js" defer></script>
</head>
<body hx-boost="true">
<div class="shell">
  <header class="topbar">
    <a class="brand" href="/workflows">
      <img src="/static/app-icon.svg" alt="">
      YieldCue
    </a>
    <nav class="nav">${nav}</nav>
  </header>
  <main class="container">
${flashHtml(opts.flash ?? null)}
${opts.content}
  </main>
</div>
</body>
</html>`
}
