/**
 * Mounts the authenticated UI, static assets, and the data-export routes.
 * Static assets are public (no customer data); every other route here sits
 * behind HTTP Basic auth and the cross-origin state-change guard.
 */

import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import type { Config } from '../config.ts'
import { requireUiAuth } from '../auth.ts'
import { handleExport } from '../export.ts'
import { mountWorkflows } from './workflows.ts'
import { mountIncidents } from './incidents.ts'
import { mountSettings } from './settings.ts'

export function mountUiRoutes(app: Hono, db: DatabaseSync, config: Config): void {
  app.use(
    '/static/*',
    serveStatic({
      root: './public',
      rewriteRequestPath: (path) => path.replace(/^\/static/, ''),
    })
  )

  app.use('*', requireUiAuth(config.authToken))

  app.get('/', (c) => c.redirect('/workflows', 302))
  app.get('/export', (c) => handleExport(c, db))

  mountWorkflows(app, db)
  mountIncidents(app, db)
  mountSettings(app, db)
}
