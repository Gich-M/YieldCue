/**
 * Process configuration from environment variables (§8.10).
 *
 * Startup fails before the HTTP listener opens if either token is absent,
 * shorter than 32 bytes, or the two tokens are equal.
 */

export interface Config {
  dataDir: string
  bind: string
  port: number
  authToken: string
  ingestToken: string
}

const MIN_TOKEN_BYTES = 32

function readToken(name: string): string {
  const value = process.env[name] ?? ''
  if (Buffer.byteLength(value, 'utf8') < MIN_TOKEN_BYTES) {
    throw new Error(
      `${name} is required and must be at least ${MIN_TOKEN_BYTES} bytes`
    )
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authToken = readToken('YIELDCUE_AUTH_TOKEN')
  const ingestToken = readToken('YIELDCUE_INGEST_TOKEN')

  if (authToken === ingestToken) {
    throw new Error(
      'YIELDCUE_AUTH_TOKEN and YIELDCUE_INGEST_TOKEN must differ'
    )
  }

  const port = Number(env.YIELDCUE_PORT ?? '8080')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('YIELDCUE_PORT must be an integer between 1 and 65535')
  }

  const bind = env.YIELDCUE_BIND ?? '127.0.0.1'

  return {
    dataDir: env.YIELDCUE_DATA_DIR ?? '/data',
    bind,
    port,
    authToken,
    ingestToken,
  }
}
