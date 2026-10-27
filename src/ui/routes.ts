/**
 * Mounts the browser sign-in, authenticated UI, static assets, and exports.
 * Static assets and sign-in routes are public; all other UI routes require a
 * browser session or scripted Basic credential and enforce origin checks on mutations.
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
import { handleLogin, handleLoginPage, handleLogout } from './login.ts'

export function mountUiRoutes(app: Hono, db: DatabaseSync, config: Config): void {
  app.use(
    '/static/*',
    serveStatic({
      root: './public',
      rewriteRequestPath: (path) => path.replace(/^\/static/, ''),
    })
  )

  app.get('/login', (c) => handleLoginPage(c, config))
  app.post('/login', (c) => handleLogin(c, config))

  app.use('*', requireUiAuth(config.authToken))

  app.get('/', (c) => c.redirect('/workflows', 302))
  app.post('/logout', (c) => handleLogout(c))
  app.get('/export', (c) => handleExport(c, db))

  mountWorkflows(app, db)
  mountIncidents(app, db)
  mountSettings(app, db)
}
