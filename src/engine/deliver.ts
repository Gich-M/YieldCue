/**
 * Client-local delivery adapters. Slack uses the webhook HTTP status for the
 * §8.3 retry policy. Email talks only to the operator's SMTP host. There is
 * no other outbound traffic (§8.13).
 */

import { parseJson, type AlertRouteRow, type IncidentRow } from '../db/types.ts'
import { parseSmtpDestination, sendSmtpEmail } from './smtp.ts'

const TIMEOUT_MS = 5000

export interface DeliveryContext {
  route: AlertRouteRow
  incident: IncidentRow
  workflowName: string
}

export interface SendResult {
  ok: boolean
  retryable: boolean
}

interface SlackDestination {
  webhook_url: string
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function classify(status: number | null): SendResult {
  if (status === null) return { ok: false, retryable: true }
  if (status >= 200 && status < 300) return { ok: true, retryable: false }
  if (status === 429 || status >= 500) return { ok: false, retryable: true }
  return { ok: false, retryable: false }
}

function slackBlocks(incident: IncidentRow, workflowName: string): Record<string, unknown> {
  const emoji: Record<string, string> = {
    critical: ':red_circle:',
    warning: ':yellow_circle:',
    info: ':blue_circle:',
  }
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${emoji[incident.severity] ?? ':white_circle:'} ${incident.title}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Severity:*\n${incident.severity}` },
          { type: 'mrkdwn', text: `*Status:*\n${incident.status}` },
          { type: 'mrkdwn', text: `*Workflow:*\n${workflowName}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: incident.description || '_No description_' },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Opened: ${incident.opened_at} | ID: \`${incident.id}\`` },
        ],
      },
    ],
  }
}

async function sendSlack(ctx: DeliveryContext): Promise<SendResult> {
  const dest = parseJson<SlackDestination>(ctx.route.destination)
  try {
    const res = await fetchWithTimeout(
      dest.webhook_url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackBlocks(ctx.incident, ctx.workflowName)),
      },
      TIMEOUT_MS
    )
    return classify(res.status)
  } catch {
    return { ok: false, retryable: true }
  }
}

async function sendEmail(ctx: DeliveryContext): Promise<SendResult> {
  const dest = parseSmtpDestination(parseJson(ctx.route.destination))
  if (!dest) return { ok: false, retryable: false }

  const subject = `[${ctx.incident.severity.toUpperCase()}] ${ctx.incident.title}`
  const text = [
    `[${ctx.incident.severity.toUpperCase()}] ${ctx.incident.title}`,
    '',
    ctx.incident.description || '',
    '',
    `Workflow: ${ctx.workflowName}`,
    `Opened: ${ctx.incident.opened_at}`,
  ]
    .filter(Boolean)
    .join('\n')

  const result = await sendSmtpEmail(dest, { subject, text })
  return result.ok ? { ok: true, retryable: false } : { ok: false, retryable: result.retryable }
}

export function sendDelivery(ctx: DeliveryContext): Promise<SendResult> {
  return ctx.route.integration_kind === 'slack_webhook' ? sendSlack(ctx) : sendEmail(ctx)
}
