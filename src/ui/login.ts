/** Public browser sign-in and authenticated sign-out routes. */

import type { Context } from 'hono'
import { clearUiSession, createUiSession, hasUiAuthentication, hasValidUiCredentials } from '../auth.ts'
import type { Config } from '../config.ts'
import { escapeHtml } from './layout.ts'
import { renderHtml } from './templates.ts'

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith('/')) return '/workflows'
  const baseUrl = 'http://yieldcue.local'
  try {
    const target = new URL(value, baseUrl)
    if (target.origin !== baseUrl) return '/workflows'
    return `${target.pathname}${target.search}`
  } catch {
    return '/workflows'
  }
}

function loginPage(next: string, error = ''): string {
  return renderHtml('login.html', {
    error: error ? renderHtml('login-error.html', { message: error }) : '',
    next: escapeHtml(next),
  })
}

export function handleLoginPage(c: Context, config: Config): Response {
  const next = safeNext(c.req.query('next'))
  if (hasUiAuthentication(c, config.authToken)) return c.redirect(next, 302)
  return c.html(loginPage(next))
}

export async function handleLogin(c: Context, config: Config): Promise<Response> {
  const body = await c.req.parseBody()
  const username = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const next = safeNext(typeof body.next === 'string' ? body.next : undefined)

  if (!hasValidUiCredentials(username, password, config.authToken)) {
    return c.html(loginPage(next, 'The username or password is incorrect.'), 401)
  }

  c.header('Set-Cookie', createUiSession(c, config.authToken))
  return c.redirect(next, 303)
}

export function handleLogout(c: Context): Response {
  c.header('Set-Cookie', clearUiSession(c))
  return c.redirect('/login', 303)
}
