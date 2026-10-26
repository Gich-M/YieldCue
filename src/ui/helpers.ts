/**
 * Small request/response helpers shared by the UI screen modules.
 */

import type { Context } from 'hono'
import type { Flash } from './layout.ts'

export function readFlash(c: Context): Flash | null {
  const err = c.req.query('err')
  if (err) return { kind: 'error', message: err }
  const ok = c.req.query('ok')
  if (ok) return { kind: 'success', message: ok }
  return null
}

export function redirectWithFlash(c: Context, path: string, flash: Flash): Response {
  const url = new URL(c.req.url)
  url.pathname = path
  url.search = ''
  if (flash.kind === 'success') url.searchParams.set('ok', flash.message)
  else url.searchParams.set('err', flash.message)
  return c.redirect(url.pathname + url.search, 303)
}

/** Parses an x-www-form-urlencoded body into a flat string map. */
export async function formBody(c: Context): Promise<Record<string, string>> {
  const body = await c.req.parseBody()
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) {
    out[key] = typeof value === 'string' ? value : ''
  }
  return out
}
