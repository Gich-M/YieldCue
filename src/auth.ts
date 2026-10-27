/**
 * Authentication and request-origin guards (§8.7, §8.13).
 *
 * Browser UI sign-ins use a signed, HttpOnly cookie. HTTP Basic remains
 * supported for non-browser scripted UI access; ingest uses a Bearer token.
 * State-changing UI requests reject cross-origin `Origin` values.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'

const UI_USERNAME = 'operator'
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const SESSION_COOKIE = 'yieldcue_session'
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14

/** Constant-time comparison via fixed-length SHA-256 digests. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

function credentialsFromBasicAuth(header: string): { user: string; pass: string } | null {
  const [scheme, encoded] = header.split(' ', 2)
  if (scheme !== 'Basic' || !encoded) return null

  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  if (separator === -1) return null

  return { user: decoded.slice(0, separator), pass: decoded.slice(separator + 1) }
}

export function hasValidUiCredentials(username: string, password: string, authToken: string): boolean {
  return username === UI_USERNAME && safeEqual(password, authToken)
}

function cookieValue(c: Context, name: string): string | null {
  const cookie = c.req.header('cookie') ?? ''
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=') || null
  }
  return null
}

function signSession(payload: string, authToken: string): string {
  return createHmac('sha256', authToken).update(payload).digest('base64url')
}

function isSecureRequest(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https'
}

function sessionCookie(c: Context, value: string, maxAge: number): string {
  const attributes = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (isSecureRequest(c)) attributes.push('Secure')
  return attributes.join('; ')
}

/** Creates a signed, expiring browser session cookie. */
export function createUiSession(c: Context, authToken: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS
  const payload = `v1.${expiresAt}`
  return sessionCookie(c, `${payload}.${signSession(payload, authToken)}`, SESSION_DURATION_SECONDS)
}

/** Clears the browser session cookie. */
export function clearUiSession(c: Context): string {
  return sessionCookie(c, '', 0)
}

function hasValidUiSession(c: Context, authToken: string): boolean {
  const value = cookieValue(c, SESSION_COOKIE)
  if (!value) return false

  const [version, expiresAtString, signature, ...extra] = value.split('.')
  const expiresAt = Number(expiresAtString)
  if (version !== 'v1' || !signature || extra.length > 0 || !Number.isInteger(expiresAt)) return false
  if (expiresAt <= Math.floor(Date.now() / 1000)) return false

  const payload = `${version}.${expiresAtString}`
  return safeEqual(signature, signSession(payload, authToken))
}

export function hasUiAuthentication(c: Context, authToken: string): boolean {
  if (hasValidUiSession(c, authToken)) return true
  // Browsers may retain a Basic credential after the old native prompt. Ignore
  // it for HTML navigations so the styled sign-in page is consistently shown.
  if (c.req.header('accept')?.includes('text/html')) return false
  const credentials = credentialsFromBasicAuth(c.req.header('authorization') ?? '')
  return !!credentials && hasValidUiCredentials(credentials.user, credentials.pass, authToken)
}

function isSameOrigin(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Requires a valid browser session or Basic credential and rejects cross-origin state changes. */
export function requireUiAuth(authToken: string) {
  return async (c: Context, next: Next) => {
    if (!hasUiAuthentication(c, authToken)) {
      const url = new URL(c.req.url)
      const loginUrl = `/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`
      if (c.req.header('hx-request') === 'true') {
        c.header('HX-Redirect', loginUrl)
        return c.text('Unauthorized', 401)
      }
      return c.redirect(loginUrl, 302)
    }

    if (STATE_CHANGING.has(c.req.method)) {
      const origin = c.req.header('origin')
      if (origin && !isSameOrigin(origin, c.req.header('host') ?? '')) {
        return c.text('Forbidden', 403)
      }
    }

    await next()
  }
}

/** Requires the ingest bearer token. Grants event ingest only. */
export function requireIngestAuth(ingestToken: string) {
  return async (c: Context, next: Next) => {
    const header = c.req.header('authorization') ?? ''
    const [scheme, token] = header.split(' ', 2)
    if (scheme !== 'Bearer' || !token || !safeEqual(token, ingestToken)) {
      return c.text('Unauthorized', 401)
    }
    await next()
  }
}
