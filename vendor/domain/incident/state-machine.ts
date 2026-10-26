/**
 * Incident state machine.
 * Validates transitions and enforces the fixed recurrence cooldown.
 *
 * A resolved or ignored incident may only reopen once now >= last_resolved_at + 15 minutes.
 */

import { ALLOWED_TRANSITIONS, isValidTransition, type IncidentStatus } from '@yieldcue/contracts'

/** Fixed recurrence cooldown (minutes) before a resolved or ignored incident may reopen. */
export const RECURRENCE_COOLDOWN_MINUTES = 15

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION' as const
  readonly status = 422 as const
  readonly from: IncidentStatus
  readonly to: IncidentStatus

  constructor(from: IncidentStatus, to: IncidentStatus) {
    super(`Cannot transition incident from '${from}' to '${to}'`)
    this.name = 'InvalidTransitionError'
    this.from = from
    this.to = to
  }
}

/**
 * Raised when a reopen transition is attempted without the `lastResolvedAt` /
 * `now` anchors required to evaluate the recurrence cooldown.
 *
 * A reopen must never silently bypass the cooldown, so a missing anchor is a
 * caller bug (typically an omitted `last_resolved_at` read), not a no-op.
 */
export class MissingCooldownAnchorError extends Error {
  readonly code = 'RECURRENCE_COOLDOWN_ANCHOR_MISSING' as const
  readonly status = 422 as const

  constructor(from: IncidentStatus, to: IncidentStatus) {
    super(
      `Cannot transition incident from '${from}' to '${to}' without both lastResolvedAt and now; ` +
      `the ${RECURRENCE_COOLDOWN_MINUTES}-minute recurrence cooldown cannot be evaluated`
    )
    this.name = 'MissingCooldownAnchorError'
  }
}

export class RecurrenceCooldownError extends Error {
  readonly code = 'RECURRENCE_COOLDOWN' as const
  readonly status = 422 as const
  readonly lastResolvedAt: string

  constructor(lastResolvedAt: string) {
    super(`Incident was resolved at ${lastResolvedAt}; recurrence cooldown (${RECURRENCE_COOLDOWN_MINUTES}m) has not elapsed`)
    this.name = 'RecurrenceCooldownError'
    this.lastResolvedAt = lastResolvedAt
  }
}

export function assertTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to)
  }
}

/** True when the cooldown has elapsed and the incident may reopen. */
export function computeRecurrenceCooldown(lastResolvedAt: string, now: string): boolean {
  const resolvedMs = new Date(lastResolvedAt).getTime()
  const nowMs = new Date(now).getTime()
  return nowMs >= resolvedMs + RECURRENCE_COOLDOWN_MINUTES * 60_000
}

/**
 * Assert a valid transition, additionally enforcing the cooldown on reopen.
 * Used by the automated evaluator; manual transitions use assertTransition().
 *
 * Reopening a `resolved` or `ignored` incident REQUIRES both anchors: omitting
 * `lastResolvedAt` throws {@link MissingCooldownAnchorError} rather than silently
 * skipping the cooldown.
 */
export function assertTransitionWithCooldown(
  from: IncidentStatus,
  to: IncidentStatus,
  opts?: { lastResolvedAt?: string; now?: string }
): void {
  assertTransition(from, to)

  const reopens = (from === 'resolved' || from === 'ignored') && to === 'open'
  if (!reopens) {
    return
  }

  const lastResolvedAt = opts?.lastResolvedAt
  const now = opts?.now
  if (!lastResolvedAt || !now) {
    throw new MissingCooldownAnchorError(from, to)
  }

  if (!computeRecurrenceCooldown(lastResolvedAt, now)) {
    throw new RecurrenceCooldownError(lastResolvedAt)
  }
}

export function computeTransitionPatch(
  to: IncidentStatus,
  now: string
): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: to }

  switch (to) {
    case 'acknowledged':
      patch.acknowledged_at = now
      break
    case 'resolved':
      patch.resolved_at = now
      patch.last_resolved_at = now
      break
    case 'open':
      // Reopened - clear timestamps
      patch.acknowledged_at = null
      patch.resolved_at = null
      patch.opened_at = now
      break
    case 'ignored':
      break
  }

  return patch
}

export function getValidTransitions(from: IncidentStatus): IncidentStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? []
}
