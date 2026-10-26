/**
 * Cooldown - dedup alert deliveries within a time window.
 * Prevents alert fatigue by skipping recently-sent notifications.
 */

export interface CooldownCheck {
  incidentId: string
  alertRouteId: string
  cooldownMinutes: number
  lastSentAt: string | null
  now: string
}

/**
 * Check if alert delivery is within cooldown window.
 */
export function isInCooldown(input: CooldownCheck): boolean {
  if (!input.lastSentAt) return false

  const lastMs = new Date(input.lastSentAt).getTime()
  const nowMs = new Date(input.now).getTime()
  const cooldownMs = input.cooldownMinutes * 60_000

  return (nowMs - lastMs) < cooldownMs
}
