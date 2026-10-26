/**
 * Authentication and request-origin guards (§8.7, §8.13).
 *
 * The UI uses HTTP Basic with username `operator`; ingest uses a Bearer token.
 * State-changing UI requests reject cross-origin `Origin` values.
 */

import { createHash } from 'node:crypto'
import type { Context, Next } from 'hono'

const UI_USERNAME = 'operator'
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Constant-time comparison via fixed-length SHA-256 digests. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest('hex')
  const hb = createHash('sha256').update(b).digest('hex')
  return ha === hb
}

function unauthorized(c: Context): Response {
  c.header('WWW-Authenticate', 'Basic realm="YieldCue"')
  return c.text('Unauthorized', 401)
}

function isSameOrigin(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Requires valid Basic credentials and rejects cross-origin state changes. */
export function requireUiAuth(authToken: string) {
  return async (c: Context, next: Next) => {
    const header = c.req.header('authorization') ?? ''
    const [scheme, encoded] = header.split(' ', 2)

    if (scheme !== 'Basic' || !encoded) return unauthorized(c)

    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const sep = decoded.indexOf(':')
    if (sep === -1) return unauthorized(c)

    const user = decoded.slice(0, sep)
    const pass = decoded.slice(sep + 1)
    if (user !== UI_USERNAME || !safeEqual(pass, authToken)) return unauthorized(c)

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
