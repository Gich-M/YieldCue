/**
 * Operator-configured SMTP delivery. The self-hosted client does not use a
 * hosted mail API; it only contacts the SMTP host stored on the destination.
 */

import { Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'

export type SmtpEncryption = 'starttls' | 'tls' | 'none'

export interface SmtpDestination {
  host: string
  port: number
  username: string
  password: string
  encryption: SmtpEncryption
  from_address: string
  from_name?: string
  to: string
}

export interface SmtpMessage {
  subject: string
  text: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isSmtpEncryption(value: string): value is SmtpEncryption {
  return value === 'starttls' || value === 'tls' || value === 'none'
}

export function isLikelyEmail(value: string): boolean {
  return EMAIL_RE.test(value)
}

export function parseSmtpDestination(raw: Record<string, unknown>): SmtpDestination | null {
  const host = String(raw.host ?? '').trim()
  const fromAddress = String(raw.from_address ?? '').trim()
  const to = String(raw.to ?? '').trim()
  const port = Number(raw.port)
  const encryption = String(raw.encryption ?? 'starttls')
  if (!host || !fromAddress || !to || !isLikelyEmail(fromAddress) || !isLikelyEmail(to)) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!isSmtpEncryption(encryption)) return null

  const fromName = String(raw.from_name ?? '').trim()
  return {
    host,
    port,
    username: String(raw.username ?? ''),
    password: String(raw.password ?? ''),
    encryption,
    from_address: fromAddress,
    ...(fromName ? { from_name: fromName } : {}),
    to,
  }
}

export function formatMailbox(address: string, name?: string): string {
  if (!name) return address
  const safe = name.replace(/[\r\n"<>]/g, '').trim()
  return safe ? `"${safe}" <${address}>` : address
}

export function buildMimeMessage(dest: SmtpDestination, message: SmtpMessage): string {
  const from = formatMailbox(dest.from_address, dest.from_name)
  const date = new Date().toUTCString()
  const subject = message.subject.replace(/[\r\n]/g, ' ')
  const body = message.text
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\r\n')
    .replace(/^\./gm, '..')
  return [
    `From: ${from}`,
    `To: ${dest.to}`,
    `Date: ${date}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
    '',
  ].join('\r\n')
}

type SmtpSocket = Socket | TLSSocket

class SmtpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
  }
}

function readResponse(socket: SmtpSocket, timeoutMs: number): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      cleanup()
      reject(new SmtpError('SMTP timeout', true))
    }, timeoutMs)

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const match = /^(\d{3})([\s-])/.exec(lines[i] ?? '')
        if (match && match[2] === ' ') {
          cleanup()
          resolve({ code: Number(match[1]), text: buffer })
          return
        }
      }
    }

    const onError = (error: Error) => {
      cleanup()
      reject(new SmtpError(error.message, true))
    }

    const onClose = () => {
      cleanup()
      reject(new SmtpError('SMTP connection closed', true))
    }

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }

    socket.on('data', onData)
    socket.on('error', onError)
    socket.on('close', onClose)
  })
}

async function command(
  socket: SmtpSocket,
  line: string,
  timeoutMs: number,
  expected: number[]
): Promise<{ code: number; text: string }> {
  socket.write(`${line}\r\n`)
  const response = await readResponse(socket, timeoutMs)
  if (!expected.includes(response.code)) {
    const retryable = response.code >= 400 && response.code < 500
    throw new SmtpError(`SMTP ${response.code}: ${response.text.trim()}`, retryable)
  }
  return response
}

function connectPlain(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new SmtpError('SMTP connect timeout', true))
    }, timeoutMs)
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(new SmtpError(error.message, true))
    })
    socket.connect(port, host, () => {
      clearTimeout(timer)
      resolve(socket)
    })
  })
}

function connectTls(host: string, port: number, timeoutMs: number, existing?: Socket): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SmtpError('SMTP TLS timeout', true))
    }, timeoutMs)
    const socket = tlsConnect(
      { host, port, socket: existing, servername: host, rejectUnauthorized: true },
      () => {
        clearTimeout(timer)
        resolve(socket)
      }
    )
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(new SmtpError(error.message, true))
    })
  })
}

function supportsAuth(ehloText: string, mechanism: string): boolean {
  return ehloText
    .split(/\r?\n/)
    .some((line) => /^250[\s-]AUTH\b/i.test(line) && new RegExp(`\\b${mechanism}\\b`, 'i').test(line))
}

async function authenticate(
  socket: SmtpSocket,
  dest: SmtpDestination,
  ehloText: string,
  timeoutMs: number
): Promise<void> {
  if (!dest.username) return
  if (supportsAuth(ehloText, 'PLAIN') || !/\bAUTH\b/i.test(ehloText)) {
    const token = Buffer.from(`\0${dest.username}\0${dest.password}`, 'utf8').toString('base64')
    await command(socket, `AUTH PLAIN ${token}`, timeoutMs, [235])
    return
  }
  if (supportsAuth(ehloText, 'LOGIN')) {
    await command(socket, 'AUTH LOGIN', timeoutMs, [334])
    await command(socket, Buffer.from(dest.username, 'utf8').toString('base64'), timeoutMs, [334])
    await command(socket, Buffer.from(dest.password, 'utf8').toString('base64'), timeoutMs, [235])
    return
  }
  throw new SmtpError('SMTP server does not advertise PLAIN or LOGIN', false)
}

export async function sendSmtpEmail(
  dest: SmtpDestination,
  message: SmtpMessage,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ ok: true } | { ok: false; retryable: boolean }> {
  let socket: SmtpSocket | null = null
  try {
    socket = dest.encryption === 'tls'
      ? await connectTls(dest.host, dest.port, timeoutMs)
      : await connectPlain(dest.host, dest.port, timeoutMs)

    const greeting = await readResponse(socket, timeoutMs)
    if (greeting.code !== 220) {
      throw new SmtpError(`SMTP ${greeting.code}: ${greeting.text.trim()}`, greeting.code >= 400 && greeting.code < 500)
    }
    let ehlo = await command(socket, `EHLO yieldcue`, timeoutMs, [250])

    if (dest.encryption === 'starttls') {
      await command(socket, 'STARTTLS', timeoutMs, [220])
      socket = await connectTls(dest.host, dest.port, timeoutMs, socket as Socket)
      ehlo = await command(socket, `EHLO yieldcue`, timeoutMs, [250])
    }

    await authenticate(socket, dest, ehlo.text, timeoutMs)
    await command(socket, `MAIL FROM:<${dest.from_address}>`, timeoutMs, [250])
    await command(socket, `RCPT TO:<${dest.to}>`, timeoutMs, [250, 251])
    await command(socket, 'DATA', timeoutMs, [354])
    socket.write(`${buildMimeMessage(dest, message)}\r\n.\r\n`)
    const accepted = await readResponse(socket, timeoutMs)
    if (accepted.code !== 250) {
      throw new SmtpError(
        `SMTP ${accepted.code}: ${accepted.text.trim()}`,
        accepted.code >= 400 && accepted.code < 500
      )
    }
    try {
      socket.write('QUIT\r\n')
    } catch {
      /* connection may already be closing */
    }
    return { ok: true }
  } catch (error) {
    const retryable = error instanceof SmtpError ? error.retryable : true
    return { ok: false, retryable }
  } finally {
    socket?.destroy()
  }
}
