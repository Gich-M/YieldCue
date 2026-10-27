import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMimeMessage, parseSmtpDestination } from '../engine/smtp.ts'

test('parseSmtpDestination accepts SMTP form fields and rejects Resend-style payloads', () => {
  const dest = parseSmtpDestination({
    host: 'smtp.example.com',
    port: '587',
    encryption: 'starttls',
    from_address: 'alerts@example.com',
    from_name: 'YieldCue',
    to: 'ops@example.com',
    username: 'alerts@example.com',
    password: 'secret',
  })
  assert.ok(dest)
  assert.equal(dest?.host, 'smtp.example.com')
  assert.equal(dest?.port, 587)
  assert.equal(dest?.encryption, 'starttls')
  assert.equal(dest?.to, 'ops@example.com')

  assert.equal(
    parseSmtpDestination({
      api_key: 're_123',
      from_address: 'alerts@example.com',
      to: 'ops@example.com',
    }),
    null
  )
})

test('buildMimeMessage is plain text and omits credentials', () => {
  const dest = parseSmtpDestination({
    host: 'smtp.example.com',
    port: 587,
    encryption: 'starttls',
    from_address: 'alerts@example.com',
    from_name: 'YieldCue',
    to: 'ops@example.com',
    password: 'should-not-appear',
  })
  assert.ok(dest)
  const mime = buildMimeMessage(dest, { subject: 'Alert', text: 'Something failed' })
  assert.match(mime, /From: "YieldCue" <alerts@example.com>/)
  assert.match(mime, /To: ops@example.com/)
  assert.match(mime, /Something failed/)
  assert.doesNotMatch(mime, /should-not-appear/)
})

test('buildMimeMessage dot-stuffs the body to protect the DATA terminator', () => {
  const dest = parseSmtpDestination({
    host: 'smtp.example.com',
    port: 587,
    encryption: 'starttls',
    from_address: 'alerts@example.com',
    to: 'ops@example.com',
  })
  assert.ok(dest)
  const mime = buildMimeMessage(dest, {
    subject: 'Alert',
    text: 'line one\n.\n.starting dot\nline four',
  })
  assert.doesNotMatch(mime, /\r\n\.\r\n/)
  assert.match(mime, /\r\n\.\.\r\n/)
  assert.match(mime, /\r\n\.\.starting dot\r\n/)
})
