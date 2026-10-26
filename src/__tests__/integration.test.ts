import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/database.ts'
import { createApp } from '../app.ts'
import { createWorkflow } from '../db/workflows.ts'
import type { Config } from '../config.ts'

const AUTH_TOKEN = 'a'.repeat(40)
const INGEST_TOKEN = 'b'.repeat(40)
const basic = `Basic ${Buffer.from(`operator:${AUTH_TOKEN}`).toString('base64')}`
const bearer = `Bearer ${INGEST_TOKEN}`

function makeConfig(dataDir: string): Config {
  return { dataDir, bind: '127.0.0.1', port: 8080, authToken: AUTH_TOKEN, ingestToken: INGEST_TOKEN }
}

test('ingest + auth + cross-origin integration', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'yieldcue-test-'))
  const db = openDatabase(dataDir)
  const app = createApp(db, makeConfig(dataDir))

  try {
    let res = await app.request('/health')
    assert.equal(res.status, 200)

    res = await app.request('/v1/ingest/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 401)

    const workflow = createWorkflow(db, { name: 'Test', workflow_key: 'test-wf' })

    res = await app.request('/v1/ingest/events', {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: JSON.stringify({
        ingest_version: 1,
        event_type: 'heartbeat',
        workflow_key: 'test-wf',
        occurred_at: new Date().toISOString(),
        context: {},
      }),
    })
    assert.equal(res.status, 202)
    assert.equal((await res.json()).data.duplicate, false)

    res = await app.request('/v1/ingest/events', {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: JSON.stringify({
        ingest_version: 1,
        event_type: 'heartbeat',
        workflow_key: 'missing',
        occurred_at: new Date().toISOString(),
        context: {},
      }),
    })
    assert.equal(res.status, 404)

    res = await app.request('/workflows')
    assert.equal(res.status, 401)

    res = await app.request('/workflows', { headers: { authorization: basic } })
    assert.equal(res.status, 200)

    res = await app.request('/workflows', {
      method: 'POST',
      headers: {
        authorization: basic,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'http://evil.example',
      },
      body: 'name=Evil&workflow_key=evil',
    })
    assert.equal(res.status, 403)

    void workflow
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    db.close()
  }
})
