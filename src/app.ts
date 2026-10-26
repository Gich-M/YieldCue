/**
 * Hono application wiring (§8.7). The only stable external routes are
 * `GET /health` (unauthenticated) and `POST /v1/ingest/events` (Bearer).
 * Every UI, settings, and export route lives behind the UI Basic-auth guard.
 */

import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import type { Config } from './config.ts'
import { requireIngestAuth } from './auth.ts'
import { handleIngest } from './ingest.ts'
import { mountUiRoutes } from './ui/routes.ts'

export function createApp(db: DatabaseSync, config: Config): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true }))

  app.post('/v1/ingest/events', requireIngestAuth(config.ingestToken), (c) =>
    handleIngest(c, db)
  )

  mountUiRoutes(app, db, config)

  return app
}
