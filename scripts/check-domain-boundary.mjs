/**
 * Release gate: the vendored `domain` and `notifications` packages must be
 * pure. They may import only `@yieldcue/contracts` (and its subpaths) plus
 * their own relative modules. No database, Supabase, Cloudflare, network,
 * or Node built-in imports are permitted (§8.5, §11 A).
 *
 * Usage: node scripts/check-domain-boundary.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const VENDOR = join(root, 'vendor')
const PACKAGES = ['domain', 'notifications']

const FORBIDDEN = [
  '@supabase',
  'supabase',
  '@cloudflare',
  'cloudflare',
  'wrangler',
  '@hono',
  'hono',
  'express',
  'fastify',
  'node:http',
  'node:https',
  'node:net',
  'node:tls',
  'node:dns',
  'node:undici',
  'undici',
]

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

function isAllowed(specifier) {
  return (
    specifier.startsWith('.') ||
    specifier === '@yieldcue/contracts' ||
    specifier.startsWith('@yieldcue/contracts/')
  )
}

function extractSpecifiers(source) {
  const out = new Set()
  const patterns = [
    /^\s*(?:import|export)\s+(?:type\s+)?(?:[^'"`]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
    /^\s*(?:import|export)\s+['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let match
    while ((match = re.exec(source)) !== null) out.add(match[1])
  }
  return out
}

const violations = []

for (const pkg of PACKAGES) {
  const dir = join(VENDOR, pkg)
  for (const file of walk(dir)) {
    const rel = file.slice(root.length + 1)
    const source = readFileSync(file, 'utf8')
    for (const specifier of extractSpecifiers(source)) {
      if (isAllowed(specifier)) continue
      const forbidden = FORBIDDEN.some((f) => specifier.includes(f))
      violations.push({ file: rel, specifier, forbidden })
    }
  }
}

if (violations.length) {
  for (const v of violations) {
    const tag = v.forbidden ? 'FORBIDDEN' : 'non-contract external'
    console.error(`${tag} import in ${v.file}: ${v.specifier}`)
  }
  console.error(`\n${violations.length} boundary violation(s) found.`)
  process.exit(1)
}

console.log(`OK: ${PACKAGES.join(' and ')} import only contracts and relative modules.`)
