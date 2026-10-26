/**
 * Process entrypoint. Loads configuration (failing before the listener opens
 * if tokens are invalid), opens and migrates SQLite, then serves and starts
 * the background timer.
 */

import { serve } from '@hono/node-server'
import { loadConfig } from './config.ts'
import { openDatabase } from './db/database.ts'
import { createApp } from './app.ts'
import { startScheduler } from './scheduler.ts'

function main(): void {
  const config = loadConfig()
  const db = openDatabase(config.dataDir)
  const app = createApp(db, config)

  serve({ fetch: app.fetch, hostname: config.bind, port: config.port }, (info) => {
    const host =
      info.address === '0.0.0.0' || info.address === '::'
        ? 'localhost'
        : info.address
    console.log(
      `YieldCue self-hosted listening on http://${host}:${info.port} (ingest: POST /v1/ingest/events)`
    )
  })

  startScheduler(db)
}

main()
