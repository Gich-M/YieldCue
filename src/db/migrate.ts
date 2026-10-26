/**
 * Monotonic SQLite migrations. Each migration runs in one transaction and
 * `PRAGMA user_version` records the applied version. A failed migration logs
 * its identifier and exits non-zero before serving traffic (§8.4).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations'
)

interface Migration {
  version: number
  name: string
  sql: string
}

function listMigrations(): Migration[] {
  const entries = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort()

  return entries.map((name) => {
    const version = Number.parseInt(name.split('_')[0], 10)
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
    return { version, name, sql }
  })
}

export function runMigrations(db: DatabaseSync): void {
  const current = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const applied = current.user_version

  for (const migration of listMigrations()) {
    if (migration.version <= applied) {
      continue
    }

    try {
      db.exec('BEGIN')
      db.exec(migration.sql)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Migration ${migration.name} failed: ${message}`)
      throw error
    }
  }
}
