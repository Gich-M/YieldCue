/**
 * Loads editable HTML templates from src/ui/html and fills {{placeholders}}.
 * Development reads templates for each request, so an edited file is visible
 * on refresh. Production caches source after its first read.
 * Values are inserted as-is; escape user data before passing it in.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'html')
const cache = new Map<string, string>()

export function htmlTemplate(name: string): string {
  const cached = cache.get(name)
  if (process.env.NODE_ENV === 'production' && cached) return cached
  const source = readFileSync(join(TEMPLATES_DIR, name), 'utf8')
  if (process.env.NODE_ENV === 'production') cache.set(name, source)
  return source
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

export function renderHtml(name: string, vars: Record<string, string>): string {
  return fill(htmlTemplate(name), vars)
}
